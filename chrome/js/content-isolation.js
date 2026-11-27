/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Runs at document_start in every frame. Injects `maccMainWorld` into the
// page's main world so script-visible storage follows the tab's container:
//   document.cookie / cookieStore -> `MACC<n>~` prefixed cookie names
//   localStorage / sessionStorage -> `MACC<n>~` prefixed keys
//   indexedDB, caches, BroadcastChannel -> `MACC<n>~` prefixed names
// Default (no container) pages see everything except prefixed entries.
// Service worker registration is disabled in container pages and on origins
// that have been used in a container (see isolation.js).
(() => {
  "use strict";

  function maccMainWorld(purge) {
    "use strict";
    const KEY = Symbol.for("multi-account-containers.ctx");
    const ANY = /^MACC\d+~/;
    const MARKER = "MACC0~ctx";
    const SS = Storage.prototype;
    const ssGet = SS.getItem;
    const ssSet = SS.setItem;

    function detect(win) {
      // 1. Our Server-Timing entry: the response went through the extension.
      try {
        const nav = win.performance.getEntriesByType("navigation")[0];
        const timing = (nav && nav.serverTiming) || [];
        const e = timing.find((x) => x.name === "macc");
        if (e) {
          const [n, flag] = String(e.description).split("|");
          const ctx = { n: Number(n) || 0, block: flag === "b" };
          const p = timing.find((x) => x.name === "maccpurge");
          if (p) {
            const list = String(p.description).split(".").map((s) => {
              const [id, pn] = s.split(":");
              return { id, n: Number(pn) || 0 };
            });
            try { purge(list); } catch { /* ignore */ }
          }
          try { ssSet.call(win.sessionStorage, MARKER, JSON.stringify(ctx)); } catch { /* blocked */ }
          return ctx;
        }
      } catch { /* fall through */ }
      // 2. about:blank / srcdoc / javascript: documents inherit from their creator.
      for (const get of [() => win.parent, () => win.opener]) {
        try {
          const other = get();
          if (other && other !== win && other[KEY]) return other[KEY];
        } catch { /* cross-origin */ }
      }
      // 3. Served without touching the network (service worker, cache):
      //    the tab remembers its container for this origin.
      try {
        const m = ssGet.call(win.sessionStorage, MARKER);
        if (m) return JSON.parse(m);
      } catch { /* blocked */ }
      return { n: 0, block: false };
    }

    function patch(win, ctx) {
      if (Object.prototype.hasOwnProperty.call(win, KEY)) return;
      Object.defineProperty(win, KEY, { value: ctx });
      const n = ctx.n;
      const pre = n ? `MACC${n}~` : null;
      const own = (name) => (pre ? name.startsWith(pre) : !ANY.test(name));
      const strip = (name) => (pre ? name.slice(pre.length) : name);
      const wrap = (name) => (pre ? pre + name : name);
      const desc = (obj, prop) => obj && Object.getOwnPropertyDescriptor(obj, prop);
      const redefineGetter = (proto, prop, make) => {
        const d = desc(proto, prop);
        if (!d || !d.get) return;
        Object.defineProperty(proto, prop, { ...d, get: make(d.get) });
      };

      // ---- document.cookie ------------------------------------------------
      const cookieDesc = desc(win.Document.prototype, "cookie");
      if (cookieDesc) {
        const filter = (raw) => {
          if (!raw) return raw;
          const out = [];
          for (const part of raw.split("; ")) {
            if (pre) {
              if (part.startsWith(pre)) {
                const rest = part.slice(pre.length);
                out.push(rest[0] === "=" ? rest.slice(1) : rest);
              }
            } else if (!ANY.test(part)) {
              out.push(part);
            }
          }
          return out.join("; ");
        };
        const prefix = (v) => {
          const semi = v.indexOf(";");
          const first = (semi < 0 ? v : v.slice(0, semi)).trimStart();
          const rest = semi < 0 ? "" : v.slice(semi);
          return pre + (first.includes("=") ? first : `=${first}`) + rest;
        };
        Object.defineProperty(win.Document.prototype, "cookie", {
          configurable: true,
          enumerable: cookieDesc.enumerable,
          get() { return filter(cookieDesc.get.call(this)); },
          set(value) {
            const v = String(value);
            if (pre) cookieDesc.set.call(this, prefix(v));
            else if (!ANY.test(v.trimStart())) cookieDesc.set.call(this, v);
          },
        });
      }

      // ---- cookieStore ----------------------------------------------------
      const CS = win.CookieStore && win.CookieStore.prototype;
      if (CS) {
        const origGetAll = CS.getAll;
        const origSet = CS.set;
        const origDelete = CS.delete;
        const rename = (c) => (c && own(c.name) ? { ...c, name: strip(c.name) } : null);
        const getAll = async function (arg) {
          const name = typeof arg === "string" ? arg : arg && arg.name;
          const url = arg && typeof arg === "object" ? arg.url : undefined;
          const list = await origGetAll.call(this, url ? { url } : undefined);
          return list.map(rename).filter((c) => c && (name === undefined || c.name === name));
        };
        CS.getAll = getAll;
        CS.get = async function (arg) {
          return (await getAll.call(this, arg))[0] || null;
        };
        const named = (arg) => {
          if (typeof arg === "string") return wrap(arg);
          return { ...arg, name: wrap(String((arg && arg.name) || "")) };
        };
        CS.set = function (arg, value) {
          return typeof arg === "string" ? origSet.call(this, wrap(arg), value) : origSet.call(this, named(arg));
        };
        CS.delete = function (arg) { return origDelete.call(this, named(arg)); };
        const CCE = win.CookieChangeEvent && win.CookieChangeEvent.prototype;
        for (const prop of ["changed", "deleted"]) {
          redefineGetter(CCE, prop, (get) => function () {
            return Object.freeze(get.call(this).map(rename).filter(Boolean));
          });
        }
      }

      // ---- Web Storage ----------------------------------------------------
      const SP = win.Storage.prototype;
      const o = {
        getItem: SP.getItem, setItem: SP.setItem, removeItem: SP.removeItem,
        key: SP.key, length: desc(SP, "length").get,
      };
      const realOf = new WeakMap();
      const R = (s) => realOf.get(s) || s;
      const keys = (s) => {
        const r = R(s);
        const out = [];
        const len = o.length.call(r);
        for (let i = 0; i < len; i++) {
          const k = o.key.call(r, i);
          if (k !== null && own(k)) out.push(strip(k));
        }
        return out;
      };
      SP.getItem = function (k) { return o.getItem.call(R(this), wrap(String(k))); };
      SP.setItem = function (k, v) { return o.setItem.call(R(this), wrap(String(k)), v); };
      SP.removeItem = function (k) { return o.removeItem.call(R(this), wrap(String(k))); };
      SP.clear = function () {
        const r = R(this);
        for (const k of keys(r)) o.removeItem.call(r, wrap(k));
      };
      SP.key = function (i) {
        const ks = keys(this);
        const idx = Number(i) || 0;
        return idx >= 0 && idx < ks.length ? ks[idx] : null;
      };
      Object.defineProperty(SP, "length", {
        ...desc(SP, "length"),
        get() { return keys(this).length; },
      });
      const isMember = (p) => typeof p === "symbol" || p in SP;
      const proxyFor = (real) => {
        const p = new win.Proxy(real, {
          get(t, prop) {
            if (isMember(prop)) {
              const v = Reflect.get(t, prop, p);
              return typeof v === "function" ? v.bind(p) : v;
            }
            const v = SP.getItem.call(t, prop);
            return v === null ? undefined : v;
          },
          set(t, prop, v) {
            if (typeof prop === "symbol") return Reflect.set(t, prop, v);
            SP.setItem.call(t, prop, v);
            return true;
          },
          has(t, prop) {
            if (isMember(prop)) return prop in t;
            return SP.getItem.call(t, prop) !== null;
          },
          deleteProperty(t, prop) {
            if (typeof prop !== "symbol") SP.removeItem.call(t, prop);
            return true;
          },
          defineProperty(t, prop, d) {
            if (typeof prop !== "symbol") SP.setItem.call(t, prop, d.value);
            return true;
          },
          ownKeys(t) { return keys(t); },
          getOwnPropertyDescriptor(t, prop) {
            if (typeof prop === "symbol") return undefined;
            const v = SP.getItem.call(t, prop);
            return v === null ? undefined
              : { value: v, writable: true, enumerable: true, configurable: true };
          },
        });
        realOf.set(p, real);
        return p;
      };
      for (const prop of ["localStorage", "sessionStorage"]) {
        const holder = desc(win, prop) ? win : win.Window.prototype;
        const d = desc(holder, prop);
        if (!d || !d.get) continue;
        let cached = null;
        Object.defineProperty(holder, prop, {
          ...d,
          get() {
            const real = d.get.call(this);
            if (!real) return real;
            if (!cached || realOf.get(cached) !== real) cached = proxyFor(real);
            return cached;
          },
        });
      }
      redefineGetter(win.StorageEvent && win.StorageEvent.prototype, "key", (get) => function () {
        const k = get.call(this);
        return k !== null && own(k) ? strip(k) : k;
      });

      // ---- IndexedDB ------------------------------------------------------
      const IF = win.IDBFactory && win.IDBFactory.prototype;
      if (IF) {
        const open = IF.open;
        const del = IF.deleteDatabase;
        const dbs = IF.databases;
        IF.open = function (name, ...rest) { return open.call(this, wrap(String(name)), ...rest); };
        IF.deleteDatabase = function (name) { return del.call(this, wrap(String(name))); };
        if (dbs) {
          IF.databases = async function () {
            return (await dbs.call(this)).filter((x) => own(x.name)).map((x) => ({ ...x, name: strip(x.name) }));
          };
        }
        redefineGetter(win.IDBDatabase.prototype, "name", (get) => function () { return strip(get.call(this)); });
      }

      // ---- Cache Storage --------------------------------------------------
      const CSP = win.CacheStorage && win.CacheStorage.prototype;
      if (CSP) {
        const { open, has, keys: cacheKeys } = CSP;
        const cdel = CSP.delete;
        CSP.open = function (name) { return open.call(this, wrap(String(name))); };
        CSP.has = function (name) { return has.call(this, wrap(String(name))); };
        CSP.delete = function (name) { return cdel.call(this, wrap(String(name))); };
        CSP.keys = async function () { return (await cacheKeys.call(this)).filter(own).map(strip); };
        CSP.match = async function (request, options = {}) {
          const names = options.cacheName !== undefined ? [String(options.cacheName)] : await CSP.keys.call(this);
          for (const name of names) {
            if (!(await has.call(this, wrap(name)))) continue;
            const cache = await open.call(this, wrap(name));
            const hit = await cache.match(request, options);
            if (hit) return hit;
          }
          return undefined;
        };
      }

      // ---- BroadcastChannel -----------------------------------------------
      if (win.BroadcastChannel && pre) {
        const BC = win.BroadcastChannel;
        redefineGetter(BC.prototype, "name", (get) => function () { return strip(get.call(this)); });
        win.BroadcastChannel = new win.Proxy(BC, {
          construct(t, args, nt) {
            return Reflect.construct(t, [wrap(String(args[0])), ...args.slice(1)], nt);
          },
        });
      }

      // ---- Service workers ------------------------------------------------
      const SWC = win.ServiceWorkerContainer && win.ServiceWorkerContainer.prototype;
      if (SWC && (n || ctx.block)) {
        SWC.register = function () {
          return Promise.reject(new win.DOMException(
            "Service workers are disabled for sites used in containers", "SecurityError"));
        };
      }

      // ---- same-origin child documents ------------------------------------
      // A page can touch an about:blank iframe or popup before our content
      // script runs in it; patch those realms on first access.
      const patchChild = (child) => {
        try {
          if (child && child !== win && !Object.prototype.hasOwnProperty.call(child, KEY)) {
            patch(child, ctx);
          }
        } catch { /* cross-origin */ }
        return child;
      };
      for (const C of [win.HTMLIFrameElement, win.HTMLFrameElement, win.HTMLObjectElement]) {
        if (!C) continue;
        redefineGetter(C.prototype, "contentWindow", (get) => function () { return patchChild(get.call(this)); });
        redefineGetter(C.prototype, "contentDocument", (get) => function () {
          const docu = get.call(this);
          if (docu && docu.defaultView) patchChild(docu.defaultView);
          return docu;
        });
      }
      const origOpen = win.open;
      if (origOpen) {
        win.open = function (...args) { return patchChild(origOpen.apply(this, args)); };
      }
    }

    patch(window, detect(window));
  }

  // What this tab remembered before this load (session restore, SW pages).
  let marker = null;
  try {
    const m = sessionStorage.getItem("MACC0~ctx");
    if (m) marker = JSON.parse(m).n;
  } catch { /* storage blocked */ }

  const script = document.createElement("script");
  script.textContent = `(${maccMainWorld})(${globalThis.__maccPurgeInPage});`;
  (document.documentElement || document).appendChild(script);
  script.remove();

  // Optional colored frame around container pages (see highlight.js).
  let frame = null;
  let keeper = null;
  function setBorder(color) {
    if (!color) {
      if (keeper) keeper.disconnect();
      if (frame) frame.remove();
      frame = keeper = null;
      return;
    }
    if (!frame) {
      frame = document.createElement("macc-container-frame");
      const root = frame.attachShadow({ mode: "closed" });
      const box = document.createElement("div");
      box.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;"
        + "box-sizing:border-box;border:3px solid var(--c);border-radius:0;";
      root.append(box);
      frame.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
      // Pages that rebuild <html> or <body> shouldn't be able to drop it.
      keeper = new MutationObserver(() => {
        if (!frame) return;
        if (document.documentElement) keeper.observe(document.documentElement, { childList: true });
        if (!frame.isConnected) (document.documentElement || document).appendChild(frame);
      });
      keeper.observe(document, { childList: true });
      if (document.documentElement) keeper.observe(document.documentElement, { childList: true });
    }
    frame.style.setProperty("--c", color);
    frame.dataset.color = color;
    if (!frame.isConnected) (document.documentElement || document).appendChild(frame);
  }
  if (window === window.top) window.__maccSetBorder = setBorder;

  // Favicon dot (see highlight.js): swap the page's icon links for a copy
  // marked with the container color; follow the page's own icon changes.
  if (window === window.top && /^https?:$/.test(location.protocol)) {
    let marked = null;    // data URL we installed
    let applying = false;
    let seq = 0;
    const iconLinks = () => [...document.querySelectorAll('link[rel~="icon" i]')];
    const pageIcon = () => {
      const link = iconLinks().find((l) => !l.hasAttribute("data-macc-added"));
      if (link) return link.dataset.maccOrig || link.href;
      return new URL("/favicon.ico", location.href).href;
    };
    const apply = (url) => {
      applying = true;
      const head = document.head || document.documentElement;
      if (url) {
        let links = iconLinks();
        if (!links.length) {
          const l = document.createElement("link");
          l.rel = "icon";
          l.setAttribute("data-macc-added", "");
          head.appendChild(l);
          links = [l];
        }
        for (const l of links) {
          if (!l.hasAttribute("data-macc-added") && l.dataset.maccOrig === undefined) {
            l.dataset.maccOrig = l.getAttribute("href") || "";
          }
          l.href = url;
        }
      } else {
        for (const l of iconLinks()) {
          if (l.hasAttribute("data-macc-added")) l.remove();
          else if (l.dataset.maccOrig !== undefined) {
            l.setAttribute("href", l.dataset.maccOrig);
            delete l.dataset.maccOrig;
          }
        }
      }
      marked = url;
      Promise.resolve().then(() => { applying = false; });
    };
    const refresh = () => {
      const mine = ++seq;
      try {
        chrome.runtime.sendMessage({ __macc: "favicon", href: pageIcon() }, (res) => {
          void chrome.runtime.lastError;
          if (mine === seq && res) apply(res.url);
        });
      } catch { /* extension reloaded */ }
    };
    window.__maccRefreshFavicon = refresh;
    // The page changed its icon (e.g. unread counters): forget our copy of
    // the old original and re-mark the new one.
    const watcher = new MutationObserver((records) => {
      if (applying) return;
      let changed = false;
      for (const r of records) {
        if (r.type === "attributes" && r.target.matches && r.target.matches('link[rel~="icon" i]')
            && r.target.getAttribute("href") !== marked) {
          delete r.target.dataset.maccOrig;
          changed = true;
        }
        for (const n of r.addedNodes || []) {
          if (n.matches && n.matches('link[rel~="icon" i]') && !n.hasAttribute("data-macc-added")) changed = true;
        }
      }
      if (changed && (marked || seq)) refresh();
    });
    const start = () => {
      watcher.observe(document.head || document.documentElement, {
        subtree: true, childList: true, attributes: true, attributeFilter: ["href", "rel"],
      });
      refresh();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }

  if (window === window.top) {
    let header = null;
    try {
      const nav = performance.getEntriesByType("navigation")[0];
      const e = nav && nav.serverTiming && nav.serverTiming.find((x) => x.name === "macc");
      if (e) header = Number(String(e.description).split("|")[0]) || 0;
    } catch { /* ignore */ }
    const n = header !== null ? header : (marker || 0);
    try {
      chrome.runtime.sendMessage({ __macc: "ctx", n, header: header !== null, marker }, (res) => {
        void chrome.runtime.lastError;
        if (!res) return;
        if (res.border !== undefined) setBorder(res.border);
        if (res.marker !== undefined) {
          try {
            sessionStorage.setItem("MACC0~ctx", JSON.stringify({ n: res.marker, block: true }));
          } catch { /* storage blocked */ }
        }
        if (res.reload) location.reload();
      });
    } catch { /* extension reloaded */ }
  }
})();
