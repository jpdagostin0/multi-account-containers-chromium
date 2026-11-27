/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// "Move site data to container" (Chromium port, background page).
//
// Moves the current site's data from the tab's container (or from no
// container) into another one, then reopens the tab there:
//   cookies        every cookie of the site (registrable domain, all
//                  subdomains) is renamed from the source prefix to the
//                  target prefix in the shared jar
//   page storage   localStorage, sessionStorage, IndexedDB and Cache Storage of
//                  the tab's origin are renamed/copied by a script injected into
//                  the tab's isolated world, which sees the raw, prefixed names
// Entries that already exist in the target are overwritten by the source.
//
// UI: right-click the page or the toolbar button →
//     "Move this site's data to container" → target.
(() => {
  "use strict";

  const iso = globalThis.__maccIso;
  const { base, IDENT_KEY, idOf, csidOf } = globalThis.__maccCompat;
  const ANY_PREFIX = /^MACC(\d+)~/;
  const prefixFor = (n) => (n ? `MACC${n}~` : "");
  const lastError = () => void chrome.runtime.lastError;
  const MENU = "macc-move-data";

  const identities = () => (iso.mirror[IDENT_KEY] ? iso.mirror[IDENT_KEY].list : []);

  function siteOf(url) {
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return null;
      return globalThis.tldts.getDomain(u.hostname, { allowPrivateDomains: true }) || u.hostname;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // cookies
  // -------------------------------------------------------------------------
  const contextOfName = (name) => {
    const m = ANY_PREFIX.exec(name);
    return m ? Number(m[1]) : 0;
  };

  async function moveCookies(site, from, to) {
    const stores = await base.cookies.getAllCookieStores();
    const all = (await Promise.all(stores.map((s) => base.cookies.getAll({ storeId: s.id })))).flat();
    const mine = all.filter((c) => {
      const d = c.domain.replace(/^\./, "");
      return (d === site || d.endsWith(`.${site}`)) && contextOfName(c.name) === from
        && !(from === 0 && c.name.startsWith("MACC0~"));
    });
    let moved = 0;
    for (const c of mine) {
      const bare = from ? c.name.slice(prefixFor(from).length) : c.name;
      const host = c.domain.replace(/^\./, "");
      const url = `http${c.secure ? "s" : ""}://${host}${c.path}`;
      const details = {
        url,
        name: prefixFor(to) + bare,
        value: c.value,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        storeId: c.storeId,
      };
      if (!c.hostOnly) details.domain = c.domain;
      if (!c.session && c.expirationDate) details.expirationDate = c.expirationDate;
      if (c.partitionKey) details.partitionKey = c.partitionKey;
      try {
        await base.cookies.set(details);
        const old = { url, name: c.name, storeId: c.storeId };
        if (c.partitionKey) old.partitionKey = c.partitionKey;
        await base.cookies.remove(old);
        moved++;
      } catch (e) {
        console.warn("macc: couldn't move cookie", c.name, c.domain, e);
      }
    }
    return moved;
  }

  // -------------------------------------------------------------------------
  // page storage (runs in the tab's isolated world: raw, unpatched APIs)
  // -------------------------------------------------------------------------
  function inPage(job) {
    const ANY = /^MACC(\d+)~/;
    const pre = (n) => (n ? `MACC${n}~` : "");
    const ctx = (name) => {
      const m = ANY.exec(name);
      return m ? Number(m[1]) : 0;
    };
    const fromName = (name) => typeof name === "string" && ctx(name) === job.from
      && !(job.from === 0 && name.startsWith("MACC0~"));
    const rename = (name) => pre(job.to) + name.slice(pre(job.from).length);
    const req = (r) => new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });

    function moveWebStorage(store) {
      const keys = [];
      for (let i = 0; i < store.length; i++) keys.push(store.key(i));
      let n = 0;
      for (const k of keys.filter(fromName)) {
        store.setItem(rename(k), store.getItem(k));
        store.removeItem(k);
        n++;
      }
      return n;
    }

    async function copyDb(srcName, dstName) {
      const src = await req(indexedDB.open(srcName));
      const schema = [...src.objectStoreNames].map((name) => {
        const s = src.transaction(name, "readonly").objectStore(name);
        return {
          name,
          keyPath: s.keyPath,
          autoIncrement: s.autoIncrement,
          indexes: [...s.indexNames].map((i) => {
            const ix = s.index(i);
            return { name: i, keyPath: ix.keyPath, unique: ix.unique, multiEntry: ix.multiEntry };
          }),
        };
      });
      const data = {};
      for (const st of schema) {
        const s = src.transaction(st.name, "readonly").objectStore(st.name);
        data[st.name] = { keys: await req(s.getAllKeys()), values: await req(s.getAll()) };
      }
      const version = src.version;
      src.close();
      await req(indexedDB.deleteDatabase(dstName));
      const open = indexedDB.open(dstName, version);
      open.onupgradeneeded = () => {
        const db = open.result;
        for (const st of schema) {
          const os = db.createObjectStore(st.name, { keyPath: st.keyPath, autoIncrement: st.autoIncrement });
          for (const ix of st.indexes) os.createIndex(ix.name, ix.keyPath, { unique: ix.unique, multiEntry: ix.multiEntry });
        }
      };
      const dst = await req(open);
      for (const st of schema) {
        const tx = dst.transaction(st.name, "readwrite");
        const os = tx.objectStore(st.name);
        const { keys, values } = data[st.name];
        values.forEach((v, i) => (st.keyPath === null ? os.put(v, keys[i]) : os.put(v)));
        await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      }
      dst.close();
      await req(indexedDB.deleteDatabase(srcName));
    }

    async function moveCaches() {
      let n = 0;
      for (const name of (await caches.keys()).filter(fromName)) {
        const src = await caches.open(name);
        const dstName = rename(name);
        await caches.delete(dstName);
        const dst = await caches.open(dstName);
        for (const r of await src.keys()) {
          const res = await src.match(r);
          if (res) await dst.put(r, res);
        }
        await caches.delete(name);
        n++;
      }
      return n;
    }

    (async () => {
      const result = { localStorage: 0, sessionStorage: 0, indexedDB: 0, caches: 0, errors: [] };
      try { result.localStorage = moveWebStorage(localStorage); } catch (e) { result.errors.push(`localStorage: ${e}`); }
      try { result.sessionStorage = moveWebStorage(sessionStorage); } catch (e) { result.errors.push(`sessionStorage: ${e}`); }
      try {
        for (const d of (await indexedDB.databases()).filter((x) => fromName(x.name))) {
          await copyDb(d.name, rename(d.name));
          result.indexedDB++;
        }
      } catch (e) { result.errors.push(`indexedDB: ${e}`); }
      try { result.caches = await moveCaches(); } catch (e) { result.errors.push(`caches: ${e}`); }
      return result;
    })().then((result) => chrome.runtime.sendMessage({ __macc: "moved", id: job.id, result }));
  }

  const waiting = new Map();
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.__macc !== "moved") return;
    const cb = waiting.get(msg.id);
    if (cb) {
      waiting.delete(msg.id);
      cb(msg.result);
    }
  });

  function movePageStorage(tabId, from, to) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => { waiting.delete(id); resolve({ errors: ["timed out"] }); }, 30000);
      waiting.set(id, (r) => { clearTimeout(timer); resolve(r); });
      chrome.tabs.executeScript(tabId, {
        code: `(${inPage})(${JSON.stringify({ id, from, to })})`,
      }, () => {
        const err = chrome.runtime.lastError;
        if (err) {
          clearTimeout(timer);
          waiting.delete(id);
          resolve({ errors: [err.message] });
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // the whole move
  // -------------------------------------------------------------------------
  async function moveSiteData(tabId, toCsid) {
    const tab = await base.tabs.get(tabId);
    const site = siteOf(tab.url);
    if (!site) throw new Error("Only web pages have site data to move");
    const from = iso.containerOf(tabId);
    const to = idOf(toCsid);
    if (from === to) return { site, from: csidOf(from), to: csidOf(to), cookies: 0 };
    if (!iso.identityExists(to)) throw new Error(`Unknown container ${toCsid}`);
    const storage = await movePageStorage(tabId, from, to);
    const cookies = await moveCookies(site, from, to);
    // Reopen the tab in the target container, now holding the data.
    iso.setTab(tabId, csidOf(to));
    await new Promise((r) => chrome.tabs.reload(tabId, { bypassCache: true }, () => { lastError(); r(); }));
    return { site, from: csidOf(from), to: csidOf(to), cookies, ...storage };
  }

  // -------------------------------------------------------------------------
  // context menu
  // -------------------------------------------------------------------------
  let building = Promise.resolve();
  function buildMenu() {
    building = building.then(() => new Promise((resolve) => {
      chrome.contextMenus.remove(MENU, () => {
        lastError();
        const contexts = ["page", "frame", "browser_action"];
        const documentUrlPatterns = ["http://*/*", "https://*/*"];
        chrome.contextMenus.create({ id: MENU, title: "Move this site's data to container", contexts }, lastError);
        const targets = [{ id: 0, name: "No container" }, ...identities()];
        for (const t of targets) {
          chrome.contextMenus.create({
            id: `${MENU}:${csidOf(t.id)}`,
            parentId: MENU,
            title: t.name,
            contexts,
            documentUrlPatterns: contexts.includes("browser_action") ? undefined : documentUrlPatterns,
          }, lastError);
        }
        resolve();
      });
    }));
    return building;
  }

  function notify(tabId, text) {
    chrome.tabs.executeScript(tabId, {
      code: `setTimeout(() => console.info(${JSON.stringify(`Multi-Account Containers: ${text}`)}), 0)`,
    }, lastError);
    chrome.browserAction.setBadgeText({ tabId, text: "✓" }, lastError);
  }

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab || typeof info.menuItemId !== "string" || !info.menuItemId.startsWith(`${MENU}:`)) return;
    const to = info.menuItemId.slice(MENU.length + 1);
    try {
      const r = await moveSiteData(tab.id, to);
      notify(tab.id, `moved ${r.site}: ${r.cookies} cookies, ${r.localStorage || 0} localStorage keys, `
        + `${r.indexedDB || 0} databases, ${r.caches || 0} caches${r.errors && r.errors.length ? ` (errors: ${r.errors.join("; ")})` : ""}`);
    } catch (e) {
      console.warn("macc: move failed", e);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[IDENT_KEY]) setTimeout(buildMenu, 0);
  });

  globalThis.__maccMoveData = { moveSiteData, buildMenu };
  const start = () => (iso.mirror[IDENT_KEY] ? buildMenu() : setTimeout(start, 200));
  setTimeout(start, 300);
})();
