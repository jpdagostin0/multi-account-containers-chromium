/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Container highlighting for Chromium (background page): Firefox draws a
// colored line on container tabs; Chromium extensions can't style tabs, so:
//
//   tab groups   each container's tabs sit in one tab group per window, named
//                and colored after the container (Chromium draws the colored
//                label and the line under the tabs). chrome.tabGroups is
//                MV3-only, so the tab-group companion extension applies the
//                color and title.
//   icon line    (default) the tab's favicon is redrawn with a line in the
//                container's color down its left edge, so it shows in horizontal and vertical
//                tab strips alike. The page asks for the marked icon
//                (content-isolation.js); we fetch and composite it here.
//   page border  an optional colored frame around the page itself, drawn by
//                js/chrome/content-isolation.js.
//
// Settings live in storage.local `__macc_settings` (options page).
(() => {
  "use strict";

  const iso = globalThis.__maccIso;
  const { base, COLORS, IDENT_KEY } = globalThis.__maccCompat;
  const SETTINGS_KEY = "__macc_settings";
  const COMPANION = "jeedhomnaldfldmfkfekpifefpfcpbll";
  const DEFAULTS = { faviconMarker: true, tabGroups: false, pageBorder: false };
  // Container colors -> Chromium tab group colors (same palette names).
  const GROUP_COLOR = {
    blue: "blue", turquoise: "cyan", green: "green", yellow: "yellow",
    orange: "orange", red: "red", pink: "pink", purple: "purple", toolbar: "grey",
  };
  const lastError = () => void chrome.runtime.lastError;

  const settings = () => ({ ...DEFAULTS, ...(iso.mirror[SETTINGS_KEY] || {}) });
  const identity = (n) => (iso.mirror[IDENT_KEY] ? iso.mirror[IDENT_KEY].list : []).find((r) => r.id === n);

  // -------------------------------------------------------------------------
  // companion
  // -------------------------------------------------------------------------
  const companion = { available: false, version: null, error: null };
  function ask(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(COMPANION, msg, (res) => {
        const err = chrome.runtime.lastError;
        if (err) return reject(new Error(err.message));
        if (!res) return reject(new Error("no response"));
        if (res.error) return reject(new Error(res.error));
        resolve(res);
      });
    });
  }
  async function pingCompanion() {
    try {
      const res = await ask({ op: "ping" });
      companion.available = true;
      companion.version = res.version;
      companion.error = null;
    } catch (e) {
      companion.available = false;
      companion.error = e.message;
    }
    return companion.available;
  }
  chrome.management.onEnabled.addListener((info) => { if (info.id === COMPANION) syncAll(); });
  chrome.management.onInstalled.addListener((info) => { if (info.id === COMPANION) syncAll(); });

  // -------------------------------------------------------------------------
  // tab groups
  // -------------------------------------------------------------------------
  /** "windowId:n" -> groupId of the group we made for that container */
  const groups = new Map();
  const ourGroups = () => new Set(groups.values());
  const queue = new Map(); // tabId -> pending promise (serialise per tab)
  let busy = Promise.resolve();

  const tabsInGroup = (groupId) => base.tabs.query({ groupId }).catch(() => []);

  async function styleGroup(groupId, n) {
    const rec = identity(n);
    if (!rec) return;
    await ask({ op: "update", groupId, props: { title: rec.name, color: GROUP_COLOR[rec.color] || "grey" } });
  }

  async function groupFor(windowId, n, tabId) {
    const key = `${windowId}:${n}`;
    const existing = groups.get(key);
    if (existing !== undefined && (await tabsInGroup(existing)).some((t) => t.windowId === windowId)) {
      await new Promise((r) => chrome.tabs.group({ groupId: existing, tabIds: [tabId] }, () => { lastError(); r(); }));
      return existing;
    }
    const groupId = await new Promise((resolve, reject) => {
      chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId } }, (id) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(id);
      });
    });
    groups.set(key, groupId);
    await styleGroup(groupId, n).catch(() => {});
    return groupId;
  }

  async function syncTab(tabId) {
    let tab;
    try { tab = await base.tabs.get(tabId); } catch { return; }
    const n = iso.containerOf(tabId);
    const mine = ourGroups();
    const inOurs = tab.groupId !== undefined && tab.groupId >= 0 && mine.has(tab.groupId);
    if (!settings().tabGroups || !companion.available || !n || !identity(n)) {
      if (inOurs) await new Promise((r) => chrome.tabs.ungroup(tabId, () => { lastError(); r(); }));
      return;
    }
    if (tab.pinned) return; // pinned tabs can't be grouped
    if (tab.groupId >= 0 && !inOurs) return; // the user's own group: leave it
    if (inOurs && groups.get(`${tab.windowId}:${n}`) === tab.groupId) return;
    await groupFor(tab.windowId, n, tabId).catch(() => {});
  }

  function schedule(tabId) {
    if (queue.has(tabId)) return queue.get(tabId);
    const p = busy = busy.then(() => syncTab(tabId)).catch(() => {}).finally(() => queue.delete(tabId));
    queue.set(tabId, p);
    return p;
  }

  async function adoptExisting() {
    // After a restart, reuse groups that already carry a container's name.
    if (!companion.available) return;
    let found = [];
    try { found = (await ask({ op: "query", query: {} })).groups || []; } catch { return; }
    const list = iso.mirror[IDENT_KEY] ? iso.mirror[IDENT_KEY].list : [];
    for (const g of found) {
      const rec = list.find((r) => r.name === g.title && (GROUP_COLOR[r.color] || "grey") === g.color);
      if (rec && !groups.has(`${g.windowId}:${rec.id}`)) groups.set(`${g.windowId}:${rec.id}`, g.id);
    }
  }

  async function syncAll() {
    await pingCompanion();
    await adoptExisting();
    const all = await base.tabs.query({});
    all.forEach((t) => schedule(t.id));
    all.forEach((t) => applyBorder(t.id));
    all.forEach((t) => refreshFavicon(t.id));
  }

  iso.listeners.tabContainerChanged.push((tabId, n) => {
    if (n === null) return;
    schedule(tabId);
    applyBorder(tabId);
    refreshFavicon(tabId);
  });
  chrome.tabs.onAttached.addListener((tabId) => schedule(tabId));
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    // Pulled out of its container group (drag, sort, unpin...): put it back.
    if ("groupId" in info || "pinned" in info) {
      if (iso.containerOf(tabId)) schedule(tabId);
    }
  });
  chrome.tabs.onRemoved.addListener(() => {
    for (const [key, gid] of groups) {
      tabsInGroup(gid).then((l) => { if (!l.length && groups.get(key) === gid) groups.delete(key); });
    }
  });

  // -------------------------------------------------------------------------
  // page border
  // -------------------------------------------------------------------------
  function borderColor(n) {
    if (!settings().pageBorder || !n) return null;
    const rec = identity(n);
    return rec ? (COLORS[rec.color] || COLORS.blue) : null;
  }

  function applyBorder(tabId) {
    const color = borderColor(iso.containerOf(tabId));
    chrome.tabs.executeScript(tabId, {
      code: `window.__maccSetBorder && window.__maccSetBorder(${JSON.stringify(color)})`,
      runAt: "document_start",
    }, lastError);
  }

  // -------------------------------------------------------------------------
  // favicon dot
  // -------------------------------------------------------------------------
  const iconCache = new Map(); // "href|color" -> data URL
  function markerColor(n) {
    if (!settings().faviconMarker || !n) return null;
    const rec = identity(n);
    return rec ? (COLORS[rec.color] || COLORS.blue) : null;
  }

  function loadImage(href) {
    return new Promise((resolve) => {
      if (!href || !/^(https?|data):/.test(href)) return resolve(null);
      const done = (img) => { clearTimeout(timer); resolve(img); };
      const timer = setTimeout(() => done(null), 5000);
      const fromBlob = (blob) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); done(img); };
        img.onerror = () => { URL.revokeObjectURL(url); done(null); };
        img.src = url;
      };
      // Fetched without cookies, from the extension (no page CORS limits).
      fetch(href, { credentials: "omit", cache: "force-cache" })
        .then((res) => (res.ok ? res.blob() : null))
        .then((blob) => (blob && blob.size ? fromBlob(blob) : done(null)))
        .catch(() => done(null));
    });
  }

  async function markedIcon(href, color) {
    const key = `${href}|${color}`;
    if (iconCache.has(key)) return iconCache.get(key);
    const img = await loadImage(href);
    const S = 32;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext("2d");
    // A line in the container's color down the left edge (2 CSS px at the
    // usual 16px tab icon size), with the site's icon shrunk beside it.
    const BAR = 4;
    const GAP = 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(0, 0, BAR, S, BAR / 2);
    ctx.fill();
    if (img) {
      const size = S - BAR - GAP;
      ctx.drawImage(img, BAR + GAP, (S - size) / 2, size, size);
    }
    const url = canvas.toDataURL("image/png");
    if (iconCache.size > 300) iconCache.delete(iconCache.keys().next().value);
    iconCache.set(key, url);
    return url;
  }

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (!msg || msg.__macc !== "favicon" || !sender.tab || sender.frameId !== 0) return undefined;
    const color = markerColor(iso.containerOf(sender.tab.id));
    if (!color) {
      respond({ url: null });
      return undefined;
    }
    markedIcon(msg.href, color).then((url) => respond({ url }), () => respond({ url: null }));
    return true;
  });

  // Inject (or re-inject) js/chrome/favicon.js: tabs opened before the
  // extension (re)started don't have the content script yet.
  function refreshFavicon(tabId) {
    chrome.tabs.executeScript(tabId, { file: "js/chrome/favicon.js" }, lastError);
  }

  // -------------------------------------------------------------------------
  // reacting to settings / identity changes
  // -------------------------------------------------------------------------
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[SETTINGS_KEY]) setTimeout(syncAll, 0);
    if (changes[IDENT_KEY]) {
      setTimeout(async () => {
        for (const [key, gid] of groups) {
          const n = Number(key.split(":")[1]);
          if (identity(n)) styleGroup(gid, n).catch(() => {});
        }
        (await base.tabs.query({})).forEach((t) => { applyBorder(t.id); refreshFavicon(t.id); });
      }, 0);
    }
  });

  globalThis.__maccHighlight = {
    status: () => ({ ...settings(), companion: { ...companion }, companionId: COMPANION }),
    borderColorForTab: (tabId) => borderColor(iso.containerOf(tabId)),
    async setSettings(patch) {
      await base.storage.local.set({ [SETTINGS_KEY]: { ...settings(), ...patch } });
    },
    syncAll,
    groupOf: (windowId, n) => groups.get(`${windowId}:${n}`),
  };

  const start = () => (iso.mirror[IDENT_KEY] ? syncAll() : setTimeout(start, 200));
  setTimeout(start, 500);
})();
