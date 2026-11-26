/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Container isolation engine for Chromium (Manifest V2, background page).
//
// Chromium has a single cookie jar per profile, so containers are emulated by
// renaming cookies inside it: a cookie `sid` set in container 3 is stored as
// `MACC3~sid`. Chromium still does all the real cookie work (domain/path
// matching, expiry, Secure, SameSite, HttpOnly); we just rewrite names:
//
//   request  Cookie:      keep only the context's own `MACC<n>~` cookies, unprefixed
//                         (default context: drop every `MACC*~` cookie)
//   response Set-Cookie:  prefix the name with the context's `MACC<n>~`
//   page JS:              js/chrome/content-isolation.js patches document.cookie,
//                         cookieStore, Web Storage, IndexedDB, Cache Storage and
//                         BroadcastChannel the same way in the page's main world
//
// Documents learn their container synchronously from `Server-Timing` entries
// added to every document response (readable through
// performance.getEntriesByType("navigation") at document_start):
//   macc;desc="<n>[|b]"          container number, b = service workers blocked
//   maccpurge;desc="<id>:<n>..." per-container storage wipes still to apply
// and remember it in the tab's sessionStorage, which also covers documents
// that never reach the network (service worker / cache) and session restore.
(() => {
  "use strict";

  const { IDENT_KEY, COLORS, SEED, idOf, csidOf, base } = globalThis.__maccCompat;
  const STATE_KEY = "__macc_tabs";
  const SW_KEY = "__macc_sw_owner";
  const PURGE_KEY = "__macc_purges";
  const ANY_PREFIX = /^MACC(\d+)~/;
  const SHARED = -1;
  const prefixFor = (n) => `MACC${n}~`;
  const lastError = () => void chrome.runtime.lastError;

  /** tabId -> container number (absent = default) */
  const tabs = new Map();
  /** requestId -> container number, for navigations that switch container */
  const requestOverride = new Map();
  /** tabId -> container number the in-flight top-level navigation will commit to */
  const pendingCommit = new Map();
  /** storage.local mirror, for synchronous lookups inside blocking listeners */
  const mirror = {};
  /** origin -> container that owns its service workers (SHARED = nobody) */
  let swOwner = {};
  /** [{id, n, host}] storage wipes for page-side data */
  let purges = [];
  /** tab ids that existed when the extension started (session restore) */
  let startupTabs = new Set();
  const startedAt = Date.now();
  const recentReloads = new Map();
  /** hooks other modules (proxy.js) use to veto navigations */
  const navigationGuards = [];
  const listeners = { tabContainerChanged: [] };
  let ready = false;

  // -------------------------------------------------------------------------
  // identities
  // -------------------------------------------------------------------------
  const identityList = () => (mirror[IDENT_KEY] ? mirror[IDENT_KEY].list : SEED);
  const identity = (n) => identityList().find((r) => r.id === n);
  const identityExists = (n) => n === 0 || !!identity(n);
  const containerOf = (tabId) => tabs.get(tabId) || 0;

  // -------------------------------------------------------------------------
  // tab bookkeeping + persistence
  // -------------------------------------------------------------------------
  let persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => {
      const entries = [];
      for (const [tabId, n] of tabs) {
        try {
          const t = await base.tabs.get(tabId);
          if (!t.incognito) entries.push({ tabId, n, url: t.url || t.pendingUrl || "" });
        } catch {
          tabs.delete(tabId);
        }
      }
      chrome.storage.local.set({ [STATE_KEY]: entries });
    }, 500);
  }

  function setBadge(tabId) {
    const n = containerOf(tabId);
    const rec = n && identity(n);
    if (!rec) {
      chrome.browserAction.setBadgeText({ tabId, text: "" }, lastError);
      chrome.browserAction.setTitle({ tabId, title: "Multi-Account Containers" }, lastError);
      return;
    }
    const text = (Array.from(rec.name.trim())[0] || "•").toUpperCase();
    chrome.browserAction.setBadgeText({ tabId, text }, lastError);
    chrome.browserAction.setBadgeBackgroundColor({ tabId, color: COLORS[rec.color] || COLORS.blue }, lastError);
    chrome.browserAction.setTitle({ tabId, title: `${rec.name} — Multi-Account Containers` }, lastError);
  }

  function setTabN(tabId, n) {
    const before = containerOf(tabId);
    if (n) tabs.set(tabId, n);
    else tabs.delete(tabId);
    setBadge(tabId);
    persist();
    if (before !== n) listeners.tabContainerChanged.forEach((fn) => fn(tabId, n, before));
  }

  const reload = (tabId) => chrome.tabs.reload(tabId, { bypassCache: true }, lastError);

  async function restore() {
    const saved = mirror[STATE_KEY] || [];
    const open = await base.tabs.query({});
    startupTabs = new Set(open.map((t) => t.id));
    const used = new Set();
    const toReload = [];
    // Extension reload: tab ids survive, keep them as-is.
    for (const t of open) {
      const i = saved.findIndex((e, idx) => !used.has(idx) && e.tabId === t.id && e.url === t.url);
      if (i >= 0 && identityExists(saved[i].n)) {
        used.add(i);
        tabs.set(t.id, saved[i].n);
      }
    }
    // Browser restart: pages report their container from sessionStorage
    // (see the "ctx" message below); this URL match covers the rest, e.g.
    // discarded tabs that haven't run any script yet.
    for (const t of open) {
      if (tabs.has(t.id)) continue;
      const i = saved.findIndex((e, idx) => !used.has(idx) && e.url && e.url === t.url);
      if (i >= 0 && identityExists(saved[i].n)) {
        used.add(i);
        tabs.set(t.id, saved[i].n);
        if (!t.discarded && /^https?:/.test(t.url)) toReload.push(t.id);
      }
    }
    for (const t of open) setBadge(t.id);
    toReload.forEach((id) => {
      recentReloads.set(id, Date.now());
      reload(id);
    });
    persist();
  }

  chrome.tabs.onCreated.addListener((tab) => {
    if (tabs.has(tab.id)) return;
    if (tab.openerTabId !== undefined && tabs.has(tab.openerTabId)) {
      setTabN(tab.id, tabs.get(tab.openerTabId));
    }
  });
  chrome.webNavigation.onCreatedNavigationTarget.addListener((d) => {
    if (!tabs.has(d.tabId) && tabs.has(d.sourceTabId)) setTabN(d.tabId, tabs.get(d.sourceTabId));
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    const before = containerOf(tabId);
    tabs.delete(tabId);
    pendingCommit.delete(tabId);
    persist();
    listeners.tabContainerChanged.forEach((fn) => fn(tabId, null, before));
  });
  chrome.tabs.onReplaced.addListener((added, removed) => {
    if (tabs.has(removed)) {
      tabs.set(added, tabs.get(removed));
      tabs.delete(removed);
      setBadge(added);
      persist();
    }
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.url) persist();
    if (info.status === "loading" && tabs.has(tabId)) setBadge(tabId);
  });

  // -------------------------------------------------------------------------
  // storage mirror
  // -------------------------------------------------------------------------
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [k, v] of Object.entries(changes)) {
      if ("newValue" in v) mirror[k] = v.newValue;
      else delete mirror[k];
    }
    if (changes[IDENT_KEY]) onIdentitiesChanged(changes[IDENT_KEY]);
  });

  async function onIdentitiesChanged(change) {
    const before = new Set(((change.oldValue || {}).list || []).map((r) => r.id));
    const after = new Set(((change.newValue || {}).list || []).map((r) => r.id));
    for (const id of before) {
      if (after.has(id)) continue;
      // Firefox closes a removed container's tabs and drops all its data.
      const doomed = [...tabs].filter(([, n]) => n === id).map(([tabId]) => tabId);
      doomed.forEach((t) => tabs.delete(t));
      if (doomed.length) chrome.tabs.remove(doomed, lastError);
      await purgeCookies(csidOf(id));
      await purgeStorage(csidOf(id));
    }
    for (const [tabId] of tabs) setBadge(tabId);
    persist();
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------
  function originOf(url) {
    try {
      const u = new URL(url);
      return /^https?:$/.test(u.protocol) ? u.origin : null;
    } catch {
      return null;
    }
  }

  function filterCookieHeader(value, n) {
    const pre = n ? prefixFor(n) : null;
    const out = [];
    for (const part of value.split(/;\s*/)) {
      if (!part) continue;
      if (pre) {
        if (part.startsWith(pre)) {
          const rest = part.slice(pre.length);
          out.push(rest[0] === "=" ? rest.slice(1) : rest);
        }
      } else if (!ANY_PREFIX.test(part)) {
        out.push(part);
      }
    }
    return out.join("; ");
  }

  function cookieContexts(value) {
    const found = new Set();
    for (const part of value.split(/;\s*/)) {
      if (!part) continue;
      const m = ANY_PREFIX.exec(part);
      found.add(m ? Number(m[1]) : 0);
    }
    return found;
  }

  function prefixSetCookie(value, n) {
    const pre = prefixFor(n);
    return value.split("\n").map((line) => {
      const semi = line.indexOf(";");
      const first = (semi < 0 ? line : line.slice(0, semi)).trimStart();
      const rest = semi < 0 ? "" : line.slice(semi);
      if (ANY_PREFIX.test(first)) return line;
      return pre + (first.includes("=") ? first : `=${first}`) + rest;
    }).join("\n");
  }

  /** Which container a request belongs to. */
  function contextFor(d) {
    if (requestOverride.has(d.requestId)) return requestOverride.get(d.requestId);
    if (d.tabId >= 0) return containerOf(d.tabId);
    // No tab: service worker / shared worker traffic. Attribute it to the
    // container that owns the worker's origin, if any.
    const owner = d.initiator ? swOwner[d.initiator] : undefined;
    return owner > 0 && identityExists(owner) ? owner : 0;
  }

  // -------------------------------------------------------------------------
  // service worker ownership
  // -------------------------------------------------------------------------
  // Service workers are per origin, not per container, and their fetches have
  // no tab. The first container to use an origin owns its workers (their
  // traffic is attributed to it); once a second container uses the origin
  // the workers are removed and registration is disabled there.
  let swPersistTimer = null;
  function saveSwOwner() {
    clearTimeout(swPersistTimer);
    swPersistTimer = setTimeout(() => chrome.storage.local.set({ [SW_KEY]: swOwner }), 300);
  }

  function removeServiceWorkers(origin) {
    return new Promise((resolve) => {
      if (!chrome.browsingData) return resolve();
      chrome.browsingData.removeServiceWorkers({ origins: [origin] }, () => { lastError(); resolve(); });
    });
  }

  function claimOrigin(origin, n) {
    const owner = swOwner[origin];
    if (owner === undefined) {
      swOwner[origin] = n;
      saveSwOwner();
    } else if (owner !== n && owner !== SHARED) {
      swOwner[origin] = SHARED;
      saveSwOwner();
      return removeServiceWorkers(origin);
    }
    return Promise.resolve();
  }

  const swBlocked = (origin, n) => !!origin && swOwner[origin] !== undefined && swOwner[origin] !== n;

  // -------------------------------------------------------------------------
  // page-side storage wipes
  // -------------------------------------------------------------------------
  function purgeListFor(url) {
    let host = "";
    try { host = new URL(url).hostname; } catch { /* ignore */ }
    return purges.filter((p) => !p.host || p.host === host || host.endsWith(`.${p.host}`));
  }

  /**
   * Wipe localStorage/sessionStorage/IndexedDB/Cache Storage of one container
   * (optionally only for some hostnames). Pages apply it at document_start of
   * their next load (they get the list via Server-Timing and record what they
   * applied in their own storage); open pages are wiped right away.
   */
  async function purgeStorage(csid, hostnames) {
    const n = idOf(csid);
    const hosts = hostnames && hostnames.length ? hostnames : [null];
    const added = hosts.map((host) => ({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, n, host,
    }));
    purges = [...purges, ...added];
    await base.storage.local.set({ [PURGE_KEY]: purges });
    const open = await base.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const t of open) {
      const list = purgeListFor(t.url).filter((p) => added.includes(p));
      if (!list.length) continue;
      chrome.tabs.executeScript(t.id, {
        allFrames: true,
        code: `(${globalThis.__maccPurgeInPage})(${JSON.stringify(list)})`,
      }, lastError);
    }
  }

  // -------------------------------------------------------------------------
  // site assignment ("Always open in ..."), synchronously
  // -------------------------------------------------------------------------
  function isExempted(url, tabId) {
    try {
      return globalThis.assignManager.storageArea.isExempted(url, tabId);
    } catch {
      return false;
    }
  }

  function siteKey(url) {
    const u = new URL(url);
    const port = u.port === "80" || u.port === "443" ? "" : u.port;
    return `siteContainerMap@@_${u.hostname}${port}`;
  }

  /** Tabs being created by tabs.create({cookieStoreId}), bound by URL. */
  const expected = new Set();
  const normalizeUrl = (url) => { try { return new URL(url).href; } catch { return url; } };

  function onBeforeRequest(d) {
    if (d.tabId < 0 || d.frameId !== 0) return {};
    if (expected.size && d.type === "main_frame") {
      const href = normalizeUrl(d.url);
      for (const e of expected) {
        if (e.href === href && Date.now() - e.at < 10000) {
          expected.delete(e);
          setTabN(d.tabId, idOf(e.csid));
          break;
        }
      }
    }
    if (!ready) return {};
    const origin = originOf(d.url);
    if (!origin) return {};
    const committed = containerOf(d.tabId);
    const current = requestOverride.has(d.requestId) ? requestOverride.get(d.requestId) : committed;
    let target = current;

    const site = mirror[siteKey(d.url)];
    const wanted = site ? Number(site.userContextId) || 0 : null;
    if (site && identityExists(wanted)) {
      if (wanted !== current && !isExempted(d.url, d.tabId)) {
        if (site.neverAsk) {
          target = wanted;
        } else {
          let confirm = chrome.runtime.getURL("confirm-page.html")
            + `?url=${encodeURIComponent(d.url)}&cookieStoreId=${csidOf(wanted)}`;
          if (current) confirm += `&currentCookieStoreId=${csidOf(current)}`;
          requestOverride.delete(d.requestId);
          pendingCommit.delete(d.tabId);
          return { redirectUrl: confirm };
        }
      }
    } else if (!site && current) {
      const state = mirror[`identitiesState@@_${csidOf(current)}`];
      if (state && state.isIsolated) target = 0; // locked container
    }

    for (const guard of navigationGuards) {
      const redirectUrl = guard(d, target);
      if (redirectUrl) {
        requestOverride.delete(d.requestId);
        pendingCommit.delete(d.tabId);
        return { redirectUrl };
      }
    }

    if (target !== committed) {
      requestOverride.set(d.requestId, target);
      pendingCommit.set(d.tabId, target);
    } else {
      requestOverride.delete(d.requestId);
      pendingCommit.delete(d.tabId);
    }
    return {};
  }

  function commitPending(tabId) {
    if (!pendingCommit.has(tabId)) return;
    setTabN(tabId, pendingCommit.get(tabId));
    pendingCommit.delete(tabId);
  }

  // -------------------------------------------------------------------------
  // webRequest
  // -------------------------------------------------------------------------
  const ALL = { urls: ["<all_urls>"] };

  chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest,
    { urls: ["<all_urls>"], types: ["main_frame"] }, ["blocking"]);

  chrome.webRequest.onBeforeSendHeaders.addListener((d) => {
    const n = contextFor(d);
    const headers = d.requestHeaders;
    let changed = false;
    let foreign = false;
    for (let i = headers.length - 1; i >= 0; i--) {
      if (headers[i].name.toLowerCase() !== "cookie") continue;
      const raw = headers[i].value || "";
      for (const ctx of cookieContexts(raw)) if (ctx !== n) foreign = true;
      const v = filterCookieHeader(raw, n);
      if (v !== raw) {
        changed = true;
        if (v) headers[i].value = v;
        else headers.splice(i, 1);
      }
    }
    // The HTTP cache is shared. When another container holds cookies for
    // this URL, a cached copy may have been personalised for it: skip the
    // cache (Chromium treats a request `Cache-Control: no-cache` as a bypass).
    if (foreign) {
      const cc = headers.find((h) => h.name.toLowerCase() === "cache-control");
      if (cc) cc.value = "no-cache";
      else headers.push({ name: "Cache-Control", value: "no-cache" });
      changed = true;
    }
    return changed ? { requestHeaders: headers } : {};
  }, ALL, ["blocking", "requestHeaders", "extraHeaders"]);

  chrome.webRequest.onHeadersReceived.addListener((d) => {
    const n = contextFor(d);
    const headers = d.responseHeaders || [];
    let changed = false;
    if (n) {
      for (const h of headers) {
        if (h.name.toLowerCase() === "set-cookie" && h.value) {
          h.value = prefixSetCookie(h.value, n);
          changed = true;
        }
      }
    }
    const redirect = d.statusCode >= 300 && d.statusCode < 400;
    const isDoc = d.type === "main_frame" || d.type === "sub_frame";
    if (isDoc) {
      const origin = originOf(d.url);
      if (origin && !redirect) claimOrigin(origin, n);
      headers.push({ name: "Server-Timing", value: `macc;desc="${n}${swBlocked(origin, n) ? "|b" : ""}"` });
      const list = purgeListFor(d.url);
      if (list.length) {
        headers.push({ name: "Server-Timing", value: `maccpurge;desc="${list.map((p) => `${p.id}:${p.n}`).join(".")}"` });
      }
      changed = true;
    }
    if (d.type === "main_frame" && d.tabId >= 0 && !redirect) {
      // The response is about to commit: from here on the tab's own
      // requests belong to the new container.
      commitPending(d.tabId);
    }
    return changed ? { responseHeaders: headers } : {};
  }, ALL, ["blocking", "responseHeaders", "extraHeaders"]);

  const forget = (d) => requestOverride.delete(d.requestId);
  chrome.webRequest.onCompleted.addListener(forget, ALL);
  chrome.webRequest.onErrorOccurred.addListener(forget, ALL);

  chrome.webNavigation.onCommitted.addListener((d) => {
    if (d.frameId === 0) commitPending(d.tabId);
  });

  // The top frame reports which container its document picked up:
  //   n:      what the page is using now
  //   header: whether that came from our Server-Timing entry
  //   marker: what the tab's sessionStorage remembered before this load
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (!msg || msg.__macc !== "ctx" || !sender.tab || sender.frameId !== 0) return undefined;
    const tabId = sender.tab.id;
    const origin = originOf(sender.url || "");
    if (!origin || pendingCommit.has(tabId)) return undefined;

    // Session restore: the restored page still knows its container.
    if (!tabs.has(tabId) && startupTabs.has(tabId) && Date.now() - startedAt < 120000
        && msg.marker > 0 && identityExists(msg.marker)) {
      startupTabs.delete(tabId);
      setTabN(tabId, msg.marker);
      recentReloads.set(tabId, Date.now());
      respond({ reload: true });
      return undefined;
    }

    const expected = containerOf(tabId);
    if (msg.n === expected) return undefined;
    const last = recentReloads.get(tabId) || 0;
    if (Date.now() - last < 15000) return undefined;
    recentReloads.set(tabId, Date.now());
    if (msg.header) {
      reload(tabId);
      return undefined;
    }
    // The document never reached the network (service worker or cache):
    // take the origin's workers away from whoever owns them, fix the tab's
    // marker and load it again.
    let fix = Promise.resolve();
    if (swOwner[origin] !== undefined && swOwner[origin] !== expected) {
      swOwner[origin] = SHARED;
      saveSwOwner();
      fix = removeServiceWorkers(origin);
    }
    fix.then(() => respond({ marker: expected, reload: true }));
    return true;
  });

  // -------------------------------------------------------------------------
  // cookie removal
  // -------------------------------------------------------------------------
  function hostMatches(domain, hostnames) {
    if (!hostnames || !hostnames.length) return true;
    const d = domain.replace(/^\./, "");
    return hostnames.some((h) => d === h || h.endsWith(`.${d}`) || d.endsWith(`.${h}`));
  }

  async function purgeCookies(csid, hostnames) {
    const n = idOf(csid);
    const pre = n ? prefixFor(n) : null;
    const stores = await base.cookies.getAllCookieStores();
    const all = (await Promise.all(stores.map((s) => base.cookies.getAll({ storeId: s.id })))).flat();
    await Promise.all(all.filter((c) => {
      const mine = pre ? c.name.startsWith(pre) : !ANY_PREFIX.test(c.name);
      return mine && hostMatches(c.domain, hostnames);
    }).map((c) => {
      const host = c.domain.replace(/^\./, "");
      const url = `http${c.secure ? "s" : ""}://${host}${c.path}`;
      const details = { url, name: c.name, storeId: c.storeId };
      if (c.partitionKey) details.partitionKey = c.partitionKey;
      return base.cookies.remove(details).catch(() => {});
    }));
  }

  // -------------------------------------------------------------------------
  // public API for compat.js / proxy.js
  // -------------------------------------------------------------------------
  globalThis.__maccIso = {
    get: (tabId) => csidOf(containerOf(tabId)),
    setTab: (tabId, csid) => setTabN(tabId, idOf(csid)),
    expect(url, csid) {
      const e = { href: normalizeUrl(url), csid, at: Date.now() };
      expected.add(e);
      return e;
    },
    unexpect: (e) => expected.delete(e),
    containerOf,
    contextFor,
    identityExists,
    originOf,
    purgeCookies,
    purgeStorage,
    navigationGuards,
    listeners,
    tabs,
    mirror,
    // Used by chrome/test/e2e.mjs to simulate a browser restart.
    debug: {
      forgetTab(tabId) {
        tabs.delete(tabId);
        startupTabs.add(tabId);
      },
    },
  };

  chrome.storage.local.get(null, async (all) => {
    Object.assign(mirror, all);
    swOwner = all[SW_KEY] || {};
    purges = all[PURGE_KEY] || [];
    if (!all[IDENT_KEY]) {
      // Materialise Firefox's default containers on first run.
      const seed = { nextId: SEED.length + 1, list: SEED };
      mirror[IDENT_KEY] = seed;
      await base.storage.local.set({ [IDENT_KEY]: seed });
    }
    await restore();
    ready = true;
  });
})();
