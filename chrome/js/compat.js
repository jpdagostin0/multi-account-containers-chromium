/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Firefox-only WebExtension APIs, emulated for Chromium (Manifest V2).
//
// Loaded in every extension page right after webextension-polyfill. It swaps
// `globalThis.browser` for a thin overlay that adds:
//   - browser.contextualIdentities (stored in storage.local)
//   - tab.cookieStoreId on every Tab object, and cookieStoreId support in
//     tabs.create / tabs.query
//   - cookieStoreId-aware browsingData.removeCookies
//   - no-op stand-ins for Firefox APIs Chromium lacks (commands.update, ...)
//
// The background page owns all state (js/chrome/isolation.js exposes it as
// window.__maccIso); other pages reach it through getBackgroundPage().
(() => {
  "use strict";

  const base = globalThis.browser;
  const DEFAULT = "firefox-default";
  const CPREFIX = "firefox-container-";
  const IDENT_KEY = "__macc_identities";
  const isBackground = location.pathname === "/js/background/index.html";

  const COLORS = {
    blue: "#37adff",
    turquoise: "#00c79a",
    green: "#51cd00",
    yellow: "#ffcb00",
    orange: "#ff9f00",
    red: "#ff613d",
    pink: "#ff4bda",
    purple: "#af51f5",
    toolbar: "#7c7c7d",
  };
  const ICONS = [
    "fingerprint", "briefcase", "dollar", "cart", "vacation", "gift", "food",
    "fruit", "pet", "tree", "chill", "circle", "fence",
  ];
  // Firefox ships these four containers out of the box.
  const SEED = [
    { id: 1, name: "Personal", color: "blue", icon: "fingerprint" },
    { id: 2, name: "Work", color: "orange", icon: "briefcase" },
    { id: 3, name: "Banking", color: "green", icon: "dollar" },
    { id: 4, name: "Shopping", color: "pink", icon: "cart" },
  ];

  const NEW_TAB_URLS = new Set([
    "chrome://newtab/", "chrome://new-tab-page/", "chrome://newtab",
  ]);
  const OWN_NEW_TAB = base.runtime.getURL("newtab.html");
  const FIREFOX_NEW_TAB = new Set([
    "about:newtab", "about:home", "about:startpage",
  ]);

  const idOf = (csid) =>
    typeof csid === "string" && csid.startsWith(CPREFIX)
      ? Number(csid.slice(CPREFIX.length)) || 0 : 0;
  const csidOf = (id) => (id ? CPREFIX + id : DEFAULT);
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  function bg() {
    if (isBackground) return globalThis;
    const page = chrome.extension.getBackgroundPage();
    if (!page) throw new Error("Multi-Account Containers background page is not available");
    return page;
  }
  const iso = () => bg().__maccIso;

  function makeEvent() {
    const listeners = new Set();
    return {
      addListener: (fn) => { listeners.add(fn); },
      removeListener: (fn) => { listeners.delete(fn); },
      hasListener: (fn) => listeners.has(fn),
      _fire(...args) {
        for (const fn of listeners) {
          try {
            const r = fn(...args);
            if (r && typeof r.catch === "function") r.catch((e) => console.error(e));
          } catch (e) {
            console.error(e);
          }
        }
      },
    };
  }

  // ---------------------------------------------------------------------
  // contextualIdentities
  // ---------------------------------------------------------------------
  function toIdentity(rec) {
    return {
      cookieStoreId: csidOf(rec.id),
      name: rec.name,
      color: rec.color,
      colorCode: COLORS[rec.color] || COLORS.blue,
      icon: rec.icon,
      iconUrl: base.runtime.getURL(`img/usercontext.svg#${rec.icon}`),
    };
  }

  async function readState() {
    const r = await base.storage.local.get(IDENT_KEY);
    return r[IDENT_KEY] || null;
  }

  // Mutations are serialized in the background page so concurrent writers
  // (popup + background) can't clobber each other.
  let chain = Promise.resolve();
  function mutateLocal(fn) {
    const run = chain.then(async () => {
      const state = (await readState()) || { nextId: 5, list: clone(SEED) };
      const result = await fn(state);
      await base.storage.local.set({ [IDENT_KEY]: state });
      return result;
    });
    chain = run.catch(() => {});
    return run;
  }

  const invalid = (csid) => new Error(`Invalid contextual identity: ${csid}`);

  const ciImpl = {
    async query(details = {}) {
      const state = await readState();
      let list = state ? state.list : SEED;
      if (details && details.name !== undefined) {
        list = list.filter((r) => r.name === details.name);
      }
      return list.map(toIdentity);
    },
    async get(csid) {
      const id = idOf(csid);
      const state = await readState();
      const rec = (state ? state.list : SEED).find((r) => r.id === id);
      if (!rec) throw invalid(csid);
      return toIdentity(rec);
    },
    create(details) {
      return mutateLocal((state) => {
        const rec = {
          id: state.nextId++,
          name: String(details.name || ""),
          color: COLORS[details.color] ? details.color : "blue",
          icon: ICONS.includes(details.icon) ? details.icon : "circle",
        };
        state.list.push(rec);
        return toIdentity(rec);
      });
    },
    update(csid, details) {
      return mutateLocal((state) => {
        const rec = state.list.find((r) => r.id === idOf(csid));
        if (!rec) throw invalid(csid);
        if (details.name !== undefined) rec.name = String(details.name);
        if (details.color !== undefined && COLORS[details.color]) rec.color = details.color;
        if (details.icon !== undefined && ICONS.includes(details.icon)) rec.icon = details.icon;
        return toIdentity(rec);
      });
    },
    remove(csid) {
      return mutateLocal((state) => {
        const idx = state.list.findIndex((r) => r.id === idOf(csid));
        if (idx < 0) throw invalid(csid);
        const [rec] = state.list.splice(idx, 1);
        return toIdentity(rec);
      });
    },
    move(csids, position) {
      return mutateLocal((state) => {
        const ids = (Array.isArray(csids) ? csids : [csids]).map(idOf);
        const moving = ids.map((id) => {
          const rec = state.list.find((r) => r.id === id);
          if (!rec) throw invalid(csidOf(id));
          return rec;
        });
        state.list = state.list.filter((r) => !ids.includes(r.id));
        const at = position < 0 || position > state.list.length ? state.list.length : position;
        state.list.splice(at, 0, ...moving);
      });
    },
  };

  const ciEvents = {
    onCreated: makeEvent(),
    onUpdated: makeEvent(),
    onRemoved: makeEvent(),
  };
  // Events are derived from storage changes, so every page sees them no
  // matter which page made the change.
  base.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[IDENT_KEY]) return;
    const before = (changes[IDENT_KEY].oldValue || { list: SEED }).list;
    const after = (changes[IDENT_KEY].newValue || { list: SEED }).list;
    const old = new Map(before.map((r) => [r.id, r]));
    const now = new Map(after.map((r) => [r.id, r]));
    for (const [id, rec] of now) {
      const prev = old.get(id);
      if (!prev) {
        ciEvents.onCreated._fire({ contextualIdentity: toIdentity(rec) });
      } else if (prev.name !== rec.name || prev.color !== rec.color || prev.icon !== rec.icon) {
        ciEvents.onUpdated._fire({ contextualIdentity: toIdentity(rec) });
      }
    }
    for (const [id, rec] of old) {
      if (!now.has(id)) ciEvents.onRemoved._fire({ contextualIdentity: toIdentity(rec) });
    }
  });

  function remoteCI(name) {
    return async (...args) => {
      if (isBackground) return ciImpl[name](...args);
      return clone(await bg().__maccCompat.ci[name](...clone(args)));
    };
  }

  const contextualIdentities = {
    query: ciImpl.query,
    get: ciImpl.get,
    create: remoteCI("create"),
    update: remoteCI("update"),
    remove: remoteCI("remove"),
    move: remoteCI("move"),
    async getSupportedColors() {
      return Object.entries(COLORS)
        .filter(([c]) => c !== "toolbar")
        .map(([color, colorCode]) => ({ color, colorCode }));
    },
    async getSupportedIcons() {
      return ICONS.map((icon) => ({
        icon, iconUrl: base.runtime.getURL(`img/usercontext.svg#${icon}`),
      }));
    },
    ...ciEvents,
  };

  // ---------------------------------------------------------------------
  // tabs
  // ---------------------------------------------------------------------
  function augment(tab) {
    if (!tab || typeof tab !== "object") return tab;
    tab.cookieStoreId = iso().get(tab.id);
    // Firefox always reports a URL; Chromium leaves it empty while loading.
    if (!tab.url) tab.url = tab.pendingUrl || "about:blank";
    if (NEW_TAB_URLS.has(tab.url) || tab.url === OWN_NEW_TAB) tab.url = "about:newtab";
    if (tab.groupId === undefined) tab.groupId = -1;
    return tab;
  }
  const augmentAll = (tabs) => (Array.isArray(tabs) ? tabs.map(augment) : augment(tabs));

  function chromeUrl(url) {
    if (url === undefined || url === null) return url;
    if (FIREFOX_NEW_TAB.has(url)) return "chrome://newtab/";
    return url;
  }
  const isNetworkUrl = (url) => typeof url === "string" && /^(https?|wss?|ftp):/i.test(url);

  const tabs = new Proxy(base.tabs, {
    get(target, prop) {
      if (prop in tabOverrides) return tabOverrides[prop];
      return target[prop];
    },
  });

  function wrapTabEvent(event, tabArgIndex) {
    const map = new Map();
    return {
      addListener(fn, ...rest) {
        const wrapped = (...args) => {
          augment(args[tabArgIndex]);
          return fn(...args);
        };
        map.set(fn, wrapped);
        event.addListener(wrapped, ...rest);
      },
      removeListener(fn) {
        const wrapped = map.get(fn);
        if (wrapped) event.removeListener(wrapped);
        map.delete(fn);
      },
      hasListener: (fn) => map.has(fn),
    };
  }

  const tabOverrides = {
    async query(queryInfo = {}) {
      const q = { ...queryInfo };
      let stores = q.cookieStoreId;
      delete q.cookieStoreId;
      const hidden = q.hidden;
      delete q.hidden;
      delete q.openerTabId;
      if (hidden === true) return [];
      let result = augmentAll(await base.tabs.query(q));
      if (queryInfo.openerTabId !== undefined) {
        result = result.filter((t) => t.openerTabId === queryInfo.openerTabId);
      }
      if (stores !== undefined) {
        stores = Array.isArray(stores) ? stores : [stores];
        result = result.filter((t) => stores.includes(t.cookieStoreId));
      }
      return result;
    },
    async get(tabId) {
      return augment(await base.tabs.get(tabId));
    },
    async getCurrent() {
      return augment(await base.tabs.getCurrent());
    },
    async create(props = {}) {
      const p = { ...props };
      let csid = p.cookieStoreId;
      for (const k of ["cookieStoreId", "discarded", "openInReaderMode", "title", "muted"]) {
        delete p[k];
      }
      // Firefox: a tab opened with an opener inherits the opener's container.
      if (!csid && p.openerTabId !== undefined && p.openerTabId !== null) {
        csid = iso().get(p.openerTabId);
      }
      csid = csid || DEFAULT;
      if (csid !== DEFAULT) await contextualIdentities.get(csid);
      p.url = chromeUrl(p.url);
      // The tab's first request may go out before tabs.create resolves:
      // isolation.js binds it by URL in its (synchronous) onBeforeRequest.
      const ticket = isNetworkUrl(p.url) ? iso().expect(p.url, csid) : null;
      try {
        const tab = await base.tabs.create(p);
        iso().setTab(tab.id, csid);
        return augment(tab);
      } finally {
        if (ticket) iso().unexpect(ticket);
      }
    },
    async update(...args) {
      const props = { ...(typeof args[0] === "number" ? args[1] : args[0]) };
      for (const k of ["loadReplace", "successorTabId", "discarded"]) delete props[k];
      if (props.url !== undefined) props.url = chromeUrl(props.url);
      const tab = typeof args[0] === "number"
        ? await base.tabs.update(args[0], props)
        : await base.tabs.update(props);
      return augment(tab);
    },
    async move(ids, props) {
      return augmentAll(await base.tabs.move(ids, props));
    },
    async duplicate(tabId, props) {
      return augment(await base.tabs.duplicate(tabId, props));
    },
    async group(options) {
      if (base.tabs.group) return base.tabs.group(options);
      return -1;
    },
    onCreated: wrapTabEvent(base.tabs.onCreated, 0),
    onUpdated: wrapTabEvent(base.tabs.onUpdated, 2),
  };

  // ---------------------------------------------------------------------
  // windows
  // ---------------------------------------------------------------------
  const augmentWindow = (w) => {
    if (w && Array.isArray(w.tabs)) w.tabs.forEach(augment);
    return w;
  };
  const windows = new Proxy(base.windows, {
    get(target, prop) {
      if (prop in windowOverrides) return windowOverrides[prop];
      return target[prop];
    },
  });
  const windowOverrides = {
    async create(data = {}) {
      const d = { ...data };
      const csid = d.cookieStoreId;
      for (const k of ["cookieStoreId", "titlePreface", "allowScriptsToClose"]) delete d[k];
      if (typeof d.url === "string") d.url = chromeUrl(d.url);
      if (csid && csid !== DEFAULT) {
        const ticket = isNetworkUrl(d.url) ? iso().expect(d.url, csid) : null;
        try {
          const w = await base.windows.create(d);
          const first = w.tabs && w.tabs[0];
          if (first) iso().setTab(first.id, csid);
          return augmentWindow(await base.windows.get(w.id, { populate: true }));
        } finally {
          if (ticket) iso().unexpect(ticket);
        }
      }
      return augmentWindow(await base.windows.create(d));
    },
    async get(id, info) { return augmentWindow(await base.windows.get(id, info)); },
    async getCurrent(info) { return augmentWindow(await base.windows.getCurrent(info)); },
    async getLastFocused(info) { return augmentWindow(await base.windows.getLastFocused(info)); },
    async getAll(info) { return (await base.windows.getAll(info)).map(augmentWindow); },
  };

  // ---------------------------------------------------------------------
  // contextMenus: Chromium has no "bookmark"/"tab" contexts and no icons.
  // ---------------------------------------------------------------------
  const CHROME_CONTEXTS = new Set([
    "all", "page", "frame", "selection", "link", "editable", "image", "video",
    "audio", "browser_action", "page_action", "action",
  ]);
  const skippedMenus = new Set();
  const swallow = () => { void chrome.runtime.lastError; };
  const contextMenus = {
    ...base.contextMenus,
    create(props, cb) {
      const p = { ...props };
      delete p.icons;
      delete p.viewTypes;
      delete p.command;
      if (p.contexts) {
        p.contexts = p.contexts.filter((c) => CHROME_CONTEXTS.has(c));
        if (!p.contexts.length) {
          skippedMenus.add(p.id);
          return p.id;
        }
      }
      if (p.parentId !== undefined && skippedMenus.has(p.parentId)) {
        skippedMenus.add(p.id);
        return p.id;
      }
      return chrome.contextMenus.create(p, () => { swallow(); if (cb) cb(); });
    },
    async update(id, props) {
      if (skippedMenus.has(id)) return;
      const p = { ...props };
      delete p.icons;
      try { await base.contextMenus.update(id, p); } catch { /* missing item */ }
    },
    async remove(id) {
      if (skippedMenus.delete(id)) return;
      try { await base.contextMenus.remove(id); } catch { /* missing item */ }
    },
    removeAll: () => { skippedMenus.clear(); return base.contextMenus.removeAll(); },
    onClicked: base.contextMenus.onClicked,
  };

  // ---------------------------------------------------------------------
  // misc
  // ---------------------------------------------------------------------
  const browsingData = {
    ...(base.browsingData || {}),
    async removeCookies(options = {}) {
      return iso().purgeCookies(options.cookieStoreId || DEFAULT, options.hostnames);
    },
    async removeLocalStorage(options = {}) {
      // Wipes only this container's page storage (see isolation.js).
      return iso().purgeStorage(options.cookieStoreId || DEFAULT, options.hostnames);
    },
  };

  const browserAction = new Proxy(base.browserAction, {
    get(target, prop) {
      if (prop === "setBadgeTextColor" && !target.setBadgeTextColor) return async () => {};
      return target[prop];
    },
  });

  const commands = {
    ...base.commands,
    onCommand: base.commands.onCommand,
    getAll: base.commands.getAll,
    update: async () => {},
    reset: async () => {},
  };

  // Keep our private messages away from the upstream handler, which throws
  // on unknown methods.
  const runtime = new Proxy(base.runtime, {
    get(target, prop) {
      if (prop === "onMessage") return onMessage;
      return target[prop];
    },
  });
  const onMessageMap = new Map();
  const onMessage = {
    addListener(fn) {
      const wrapped = (msg, sender) => {
        if (msg && msg.__macc) return undefined;
        return fn(msg, sender);
      };
      onMessageMap.set(fn, wrapped);
      base.runtime.onMessage.addListener(wrapped);
    },
    removeListener(fn) {
      const w = onMessageMap.get(fn);
      if (w) base.runtime.onMessage.removeListener(w);
      onMessageMap.delete(fn);
    },
    hasListener: (fn) => onMessageMap.has(fn),
  };

  // The Firefox add-on registers an async blocking onBeforeRequest to send
  // sites to their assigned container. Chromium ignores promises from
  // blocking listeners, so isolation.js does that job synchronously and the
  // upstream listener is dropped here.
  let webRequest = base.webRequest;
  if (isBackground && base.webRequest) {
    webRequest = new Proxy(base.webRequest, {
      get(target, prop) {
        if (prop === "onBeforeRequest") {
          return {
            ...target.onBeforeRequest,
            addListener(fn, filter, extra) {
              if (extra && extra.includes("blocking")) return;
              target.onBeforeRequest.addListener(fn, filter, extra);
            },
            removeListener: (fn) => target.onBeforeRequest.removeListener(fn),
            hasListener: (fn) => target.onBeforeRequest.hasListener(fn),
          };
        }
        return target[prop];
      },
    });
  }

  const i18n = {
    ...base.i18n,
    getMessage: (name, subs) => base.i18n.getMessage(String(name).replace(/[^A-Za-z0-9_]/g, "_"), subs),
  };

  const overrides = {
    i18n,
    contextualIdentities,
    tabs,
    windows,
    contextMenus,
    browsingData,
    browserAction,
    commands,
    runtime,
    webRequest,
    // The background's Firefox proxy.onRequest hook doesn't exist here;
    // js/chrome/proxy.js does per-container routing instead.
    proxy: isBackground ? undefined : base.proxy,
  };

  globalThis.browser = new Proxy(base, {
    get(target, prop) {
      if (prop in overrides) return overrides[prop];
      return target[prop];
    },
    has(target, prop) {
      if (prop in overrides) return overrides[prop] !== undefined;
      return prop in target;
    },
  });

  globalThis.__maccCompat = {
    ci: ciImpl,
    DEFAULT,
    CPREFIX,
    IDENT_KEY,
    COLORS,
    SEED,
    idOf,
    csidOf,
    base,
    isBackground,
  };
})();
