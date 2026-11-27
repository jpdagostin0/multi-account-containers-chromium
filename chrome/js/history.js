/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Per-container history and saved favicons (Chromium port, background page).
//
// Chromium's history is shared by every container, so the extension keeps its
// own: each committed top-level http(s) navigation (including in-page
// navigations of single-page apps) is stored with the container it happened
// in, in the extension's IndexedDB. Entries older than RETENTION_DAYS are
// dropped; removing a container drops its history.
//
// Site icons are saved there too (one per origin, refreshed weekly). They're
// fetched without cookies from the icon each page declares (favicon.js
// reports it), and used by the new tab and history pages.
(() => {
  "use strict";

  const iso = globalThis.__maccIso;
  const { IDENT_KEY, base } = globalThis.__maccCompat;
  const RETENTION_DAYS = 90;
  const ICON_MAX_AGE = 7 * 864e5;
  const SKIP_TRANSITIONS = new Set(["auto_subframe", "manual_subframe", "reload"]);

  // -------------------------------------------------------------------------
  // database
  // -------------------------------------------------------------------------
  const req = (r) => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const done = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });

  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      const open = indexedDB.open("macc-history", 1);
      open.onupgradeneeded = () => {
        const d = open.result;
        const visits = d.createObjectStore("visits", { keyPath: "id", autoIncrement: true });
        visits.createIndex("time", "time");
        visits.createIndex("n_time", ["n", "time"]);
        visits.createIndex("url", "url");
        d.createObjectStore("icons", { keyPath: "origin" });
      };
      dbPromise = req(open);
    }
    return dbPromise;
  }

  async function store(name, mode = "readonly") {
    const tx = (await db()).transaction(name, mode);
    return { tx, os: tx.objectStore(name) };
  }

  // -------------------------------------------------------------------------
  // recording
  // -------------------------------------------------------------------------
  const lastVisit = new Map(); // tabId -> {id, url, time}

  async function addVisit(tabId, url, transition) {
    if (!/^https?:/.test(url)) return;
    const n = iso.containerOf(tabId);
    const now = Date.now();
    const prev = lastVisit.get(tabId);
    // Same page again within a few seconds (redirect hops, pushState echoes).
    if (prev && prev.url === url && now - prev.time < 5000) return;
    let title = "";
    try { title = (await base.tabs.get(tabId)).title || ""; } catch { /* tab gone */ }
    if (title === url || /^https?:\/\//.test(title)) title = "";
    const { tx, os } = await store("visits", "readwrite");
    const id = await req(os.add({ n, url, title, time: now, transition }));
    await done(tx);
    lastVisit.set(tabId, { id, url, time: now });
  }

  async function updateTitle(tabId, url, title) {
    const v = lastVisit.get(tabId);
    if (!v || v.url !== url || !title || title === url) return;
    const { tx, os } = await store("visits", "readwrite");
    const rec = await req(os.get(v.id));
    if (rec && rec.title !== title) {
      rec.title = title;
      os.put(rec);
    }
    await done(tx);
  }

  function incognito(tabId) {
    return new Promise((resolve) => chrome.tabs.get(tabId, (t) => {
      void chrome.runtime.lastError;
      resolve(!t || t.incognito);
    }));
  }

  chrome.webNavigation.onCommitted.addListener(async (d) => {
    if (d.frameId !== 0 || SKIP_TRANSITIONS.has(d.transitionType)) return;
    if (await incognito(d.tabId)) return;
    addVisit(d.tabId, d.url, d.transitionType).catch((e) => console.warn("macc history", e));
  });
  chrome.webNavigation.onHistoryStateUpdated.addListener(async (d) => {
    if (d.frameId !== 0 || await incognito(d.tabId)) return;
    addVisit(d.tabId, d.url, "in_page").catch((e) => console.warn("macc history", e));
  });
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.title && tab && !tab.incognito) updateTitle(tabId, tab.url, info.title).catch(() => {});
  });
  chrome.tabs.onRemoved.addListener((tabId) => lastVisit.delete(tabId));

  // -------------------------------------------------------------------------
  // queries
  // -------------------------------------------------------------------------
  /**
   * Newest first. n: container number, or null for all. text: matches title
   * or URL. before: time cursor for paging.
   */
  async function query({ n = null, text = "", before = Infinity, limit = 200 } = {}) {
    const { os } = await store("visits");
    const needle = text.trim().toLowerCase();
    const range = n === null
      ? IDBKeyRange.upperBound(before, true)
      : IDBKeyRange.bound([n, 0], [n, before], false, true);
    const source = n === null ? os.index("time") : os.index("n_time");
    const out = [];
    await new Promise((resolve, reject) => {
      const cur = source.openCursor(range, "prev");
      cur.onerror = () => reject(cur.error);
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || out.length >= limit) return resolve();
        const v = c.value;
        if (iso.identityExists(v.n) && (!needle || v.url.toLowerCase().includes(needle)
            || (v.title || "").toLowerCase().includes(needle))) out.push(v);
        c.continue();
      };
    });
    const origins = [...new Set(out.map((v) => new URL(v.url).origin))];
    const icons = await iconsFor(origins);
    return out.map((v) => ({ ...v, icon: icons[new URL(v.url).origin] || null }));
  }

  async function remove(ids) {
    const { tx, os } = await store("visits", "readwrite");
    ids.forEach((id) => os.delete(id));
    await done(tx);
  }

  async function deleteWhere(pred) {
    const { tx, os } = await store("visits", "readwrite");
    await new Promise((resolve, reject) => {
      const cur = os.openCursor();
      cur.onerror = () => reject(cur.error);
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve();
        if (pred(c.value)) c.delete();
        c.continue();
      };
    });
    await done(tx);
  }

  const clear = (n) => deleteWhere((v) => n === null || v.n === n);

  async function prune() {
    const cutoff = Date.now() - RETENTION_DAYS * 864e5;
    const { tx, os } = await store("visits", "readwrite");
    await new Promise((resolve) => {
      const cur = os.index("time").openCursor(IDBKeyRange.upperBound(cutoff));
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve();
        c.delete();
        c.continue();
      };
      cur.onerror = () => resolve();
    });
    await done(tx);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[IDENT_KEY]) return;
    const live = new Set(((changes[IDENT_KEY].newValue || {}).list || []).map((r) => r.id));
    const gone = ((changes[IDENT_KEY].oldValue || {}).list || []).filter((r) => !live.has(r.id)).map((r) => r.id);
    if (gone.length) deleteWhere((v) => gone.includes(v.n)).catch(() => {});
  });

  // -------------------------------------------------------------------------
  // favicons
  // -------------------------------------------------------------------------
  async function iconsFor(origins) {
    if (!origins.length) return {};
    const { os } = await store("icons");
    const recs = await Promise.all(origins.map((o) => req(os.get(o))));
    return Object.fromEntries(recs.filter(Boolean).map((r) => [r.origin, r.url]));
  }

  const inflight = new Set();
  async function saveIcon(origin, href) {
    if (inflight.has(origin)) return;
    inflight.add(origin);
    try {
      const { os } = await store("icons");
      const old = await req(os.get(origin));
      if (old && old.href === href && Date.now() - old.updated < ICON_MAX_AGE) return;
      const url = await globalThis.__maccHighlight.plainIcon(href);
      if (!url) return;
      const w = await store("icons", "readwrite");
      w.os.put({ origin, href, url, updated: Date.now() });
      await done(w.tx);
    } finally {
      inflight.delete(origin);
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || msg.__macc !== "favicon" || !sender.tab || !msg.href) return;
    let origin;
    try { origin = new URL(sender.tab.url).origin; } catch { return; }
    if (sender.tab.incognito) return;
    saveIcon(origin, msg.href).catch(() => {});
  });

  // Toolbar button context menu → history page.
  chrome.contextMenus.create({ id: "macc-history", title: "History by container", contexts: ["browser_action"] },
    () => void chrome.runtime.lastError);
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== "macc-history") return;
    const n = tab ? iso.containerOf(tab.id) : null;
    chrome.tabs.create({ url: chrome.runtime.getURL(`history.html${n ? `?container=${n}` : ""}`),
      index: tab ? tab.index + 1 : undefined });
  });

  globalThis.__maccHistory = { query, remove, clear, iconsFor, prune, saveIcon };

  // Icons saved by older versions in storage.local move into the database.
  base.storage.local.get("__macc_site_icons").then(async ({ __macc_site_icons: old }) => {
    if (!old) return;
    const { tx, os } = await store("icons", "readwrite");
    for (const [origin, url] of Object.entries(old)) os.put({ origin, href: "", url, updated: 0 });
    await done(tx);
    await base.storage.local.remove("__macc_site_icons");
  }).catch(() => {});

  prune().catch(() => {});
  setInterval(() => prune().catch(() => {}), 6 * 3600e3);
})();
