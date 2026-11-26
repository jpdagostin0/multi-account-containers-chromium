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
//   request  Cookie:      keep only the tab's own `MACC<n>~` cookies, unprefixed
//                         (default tabs: drop every `MACC*~` cookie)
//   response Set-Cookie:  prefix the name with the tab's `MACC<n>~`
//   page JS:              js/chrome/content-isolation.js patches document.cookie,
//                         cookieStore, Web Storage, IndexedDB, Cache Storage and
//                         BroadcastChannel the same way in the page's main world
//
// The page learns its container synchronously from a `Server-Timing: macc`
// header we add to every document response (readable through
// performance.getEntriesByType("navigation") at document_start).
(() => {
  "use strict";

  const { CPREFIX, IDENT_KEY, COLORS, SEED, idOf, csidOf, base } = globalThis.__maccCompat;
  const STATE_KEY = "__macc_tabs";
  const SWBLOCK_KEY = "__macc_container_origins";
  const ANY_PREFIX = /^MACC(\d+)~/;
  const prefixFor = (n) => `MACC${n}~`;

  /** tabId -> container number (absent = default) */
  const tabs = new Map();
  /** requestId -> container number, for navigations that switch container */
  const requestOverride = new Map();
  /** tabId -> container number the in-flight top-level navigation will commit to */
  const pendingCommit = new Map();
  /** storage.local mirror, for synchronous lookups inside blocking listeners */
  const mirror = {};
  /** origins that have been opened in some container (service workers off there) */
  let containerOrigins = new Set();
  const recentReloads = new Map();
  let ready = false;

  // -------------------------------------------------------------------------
  // identities
  // -------------------------------------------------------------------------
  function identityList() {
    const st = mirror[IDENT_KEY];
    return st ? st.list : SEED;
  }
  const identity = (n) => identityList().find((r) => r.id === n);
  const identityExists = (n) => n === 0 || !!identity(n);
  const containerOf = (tabId) => tabs.get(tabId) || 0;

  // -------------------------------------------------------------------------
  // tab bookkeeping + persistence (Chromium gives restored tabs new ids)
  // -------------------------------------------------------------------------
  let persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => {
      const entries = [];
      for (const [tabId, n] of tabs) {
        try {
          const t = await base.tabs.get(tabId);
          entries.push({ tabId, n, url: t.url || t.pendingUrl || "" });
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
    const cb = () => { void chrome.runtime.lastError; };
    if (!rec) {
      chrome.browserAction.setBadgeText({ tabId, text: "" }, cb);
      return;
    }
    const text = (Array.from(rec.name.trim())[0] || "•").toUpperCase();
    chrome.browserAction.setBadgeText({ tabId, text }, cb);
    chrome.browserAction.setBadgeBackgroundColor({ tabId, color: COLORS[rec.color] || COLORS.blue }, cb);
    chrome.browserAction.setTitle({ tabId, title: `${rec.name} — Multi-Account Containers` }, cb);
  }

  function setTabN(tabId, n) {
    if (n) tabs.set(tabId, n);
    else tabs.delete(tabId);
    setBadge(tabId);
    persist();
  }

  async function restore() {
    const saved = mirror[STATE_KEY] || [];
    const open = await base.tabs.query({});
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
    // Browser restart: match the rest by URL, in tab-strip order.
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
    for (const id of toReload) chrome.tabs.reload(id, () => void chrome.runtime.lastError);
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
    tabs.delete(tabId);
    pendingCommit.delete(tabId);
    persist();
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
      // Firefox closes a removed container's tabs and drops its data.
      const doomed = [...tabs].filter(([, n]) => n === id).map(([tabId]) => tabId);
      doomed.forEach((t) => tabs.delete(t));
      if (doomed.length) chrome.tabs.remove(doomed, () => void chrome.runtime.lastError);
      await purgeCookies(csidOf(id));
    }
    for (const [tabId] of tabs) setBadge(tabId);
    persist();
  }

  // -------------------------------------------------------------------------
  // cookie name rewriting
  // -------------------------------------------------------------------------
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

  function originOf(url) {
    try {
      const u = new URL(url);
      return /^https?:$/.test(u.protocol) ? u.origin : null;
    } catch {
      return null;
    }
  }

  function contextFor(d) {
    if (requestOverride.has(d.requestId)) return requestOverride.get(d.requestId);
    if (d.tabId < 0) return 0;
    return containerOf(d.tabId);
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

  function onBeforeRequest(d) {
    if (d.tabId < 0 || d.frameId !== 0 || !ready) return {};
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

    if (target !== committed) {
      requestOverride.set(d.requestId, target);
      pendingCommit.set(d.tabId, target);
    } else {
      requestOverride.delete(d.requestId);
      pendingCommit.delete(d.tabId);
    }
    if (target) noteContainerOrigin(origin);
    return {};
  }

  function commitPending(tabId) {
    if (!pendingCommit.has(tabId)) return;
    setTabN(tabId, pendingCommit.get(tabId));
    pendingCommit.delete(tabId);
  }

  // Service workers are shared by every tab of an origin and their fetches
  // have no tab, so they can't be attributed to a container. Origins used in
  // a container get their workers removed and registration disabled.
  function noteContainerOrigin(origin) {
    if (containerOrigins.has(origin)) return;
    containerOrigins.add(origin);
    chrome.storage.local.set({ [SWBLOCK_KEY]: [...containerOrigins] });
    if (chrome.browsingData) {
      chrome.browsingData.removeServiceWorkers({ origins: [origin] }, () => void chrome.runtime.lastError);
    }
  }

  // -------------------------------------------------------------------------
  // webRequest
  // -------------------------------------------------------------------------
  const ALL = { urls: ["<all_urls>"] };
  const NO_CACHE_TYPES = new Set(["main_frame", "sub_frame", "xmlhttprequest"]);

  chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest,
    { urls: ["<all_urls>"], types: ["main_frame"] }, ["blocking"]);

  chrome.webRequest.onBeforeSendHeaders.addListener((d) => {
    const n = contextFor(d);
    const headers = d.requestHeaders;
    let changed = false;
    for (let i = headers.length - 1; i >= 0; i--) {
      if (headers[i].name.toLowerCase() !== "cookie") continue;
      const v = filterCookieHeader(headers[i].value || "", n);
      if (v !== headers[i].value) {
        changed = true;
        if (v) headers[i].value = v;
        else headers.splice(i, 1);
      }
    }
    // The HTTP cache is shared between containers: make personalised
    // responses revalidate (with this container's cookies) instead of
    // being served straight from another container's cache entry.
    if (NO_CACHE_TYPES.has(d.type)) {
      const origin = originOf(d.url);
      if (n || (origin && containerOrigins.has(origin))) {
        if (!headers.some((h) => h.name.toLowerCase() === "cache-control")) {
          headers.push({ name: "Cache-Control", value: "no-cache" });
          changed = true;
        }
      }
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
    const isDoc = d.type === "main_frame" || d.type === "sub_frame";
    if (isDoc) {
      const origin = originOf(d.url);
      const block = n || (origin && containerOrigins.has(origin)) ? "|b" : "";
      headers.push({ name: "Server-Timing", value: `macc;desc="${n}${block}"` });
      changed = true;
    }
    if (d.type === "main_frame" && d.tabId >= 0 && !(d.statusCode >= 300 && d.statusCode < 400)) {
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

  // Safety net: the top frame reports which container its shim picked up.
  // If that disagrees with the tab (e.g. a response that bypassed our
  // header), reload once so the page comes back with the right identity.
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || msg.__macc !== "ctx" || !sender.tab || sender.frameId !== 0) return;
    const tabId = sender.tab.id;
    const expected = containerOf(tabId);
    if (pendingCommit.has(tabId) || msg.n === expected || !originOf(sender.url || "")) return;
    const last = recentReloads.get(tabId) || 0;
    if (Date.now() - last < 15000) return;
    recentReloads.set(tabId, Date.now());
    if (expected) noteContainerOrigin(originOf(sender.url));
    chrome.tabs.reload(tabId, { bypassCache: true }, () => void chrome.runtime.lastError);
  });

  // -------------------------------------------------------------------------
  // data removal
  // -------------------------------------------------------------------------
  function hostMatches(domain, hostnames) {
    if (!hostnames || !hostnames.length) return true;
    const d = domain.replace(/^\./, "");
    return hostnames.some((h) => d === h || h.endsWith(`.${d}`) || d.endsWith(`.${h}`));
  }

  async function purgeCookies(csid, hostnames) {
    const n = idOf(csid);
    const pre = n ? prefixFor(n) : null;
    const all = await base.cookies.getAll({});
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
  // public API for compat.js
  // -------------------------------------------------------------------------
  globalThis.__maccIso = {
    get: (tabId) => csidOf(containerOf(tabId)),
    setTab: (tabId, csid) => setTabN(tabId, idOf(csid)),
    purgeCookies,
  };

  chrome.storage.local.get(null, async (all) => {
    Object.assign(mirror, all);
    containerOrigins = new Set(all[SWBLOCK_KEY] || []);
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
