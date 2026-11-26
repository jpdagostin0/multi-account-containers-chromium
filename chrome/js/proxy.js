/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Per-container proxies for Chromium (background page).
//
// Chromium has one proxy configuration per profile and PAC scripts never see
// the tab, so all traffic is sent to a local helper (chrome/helper, started
// through native messaging) and every connection is tagged with its
// container: the helper answers each new CONNECT / plain-HTTP request with
// 407, and webRequest.onAuthRequired, which knows the tab, answers with a
// one-time token the helper minted for that container. The helper then routes
// the connection through the container's upstream proxy, or DIRECT.
//
// Containers are configured with Firefox's own "Advanced proxy settings" UI
// (stored by proxified-containers.js under `proxifiedContainersKey`).
//
// Chromium pools connections per top-level site, not per tab, so one tunnel
// could carry requests of two containers that have the same site open. This
// module fails closed: a site can't be open at the same time in containers
// that route differently, and the tunnels of a (site, route) pair are closed
// before that site is opened under another route.
(() => {
  "use strict";

  const iso = globalThis.__maccIso;
  const { base, csidOf } = globalThis.__maccCompat;
  const HOST = "io.github.jpdagostin0.macc_proxy";
  const lastError = () => void chrome.runtime.lastError;

  const state = {
    enabled: false,     // some container has a proxy
    helper: null,       // native port
    port: 0,            // helper's listening port
    version: null,
    applied: false,     // our PAC script is in effect
    control: null,      // proxy settings levelOfControl
    error: null,
  };
  let routes = {};      // "n" -> {type, host, port, username, password}
  let msgId = 0;
  const waiting = new Map();
  let reconnectTimer = null;
  let reconnectDelay = 1000;

  // -------------------------------------------------------------------------
  // routes
  // -------------------------------------------------------------------------
  function normalize(proxy) {
    if (!proxy || !proxy.type || !proxy.host) return null;
    const type = String(proxy.type).toLowerCase() === "socks" ? "socks5" : String(proxy.type).toLowerCase();
    if (!["http", "https", "socks5", "socks4"].includes(type)) return null;
    let username = proxy.username || "";
    let password = proxy.password || "";
    if (proxy.proxyAuthorizationHeader && /^Basic /.test(proxy.proxyAuthorizationHeader)) {
      try {
        const [u, ...p] = atob(proxy.proxyAuthorizationHeader.slice(6)).split(":");
        username = u;
        password = p.join(":");
      } catch { /* ignore malformed */ }
    }
    const defaultPort = { http: 8080, https: 443, socks5: 1080, socks4: 1080 }[type];
    return { type, host: proxy.host, port: Number(proxy.port) || defaultPort, username, password };
  }

  function readRoutes() {
    const next = {};
    for (const entry of iso.mirror.proxifiedContainersKey || []) {
      const n = globalThis.__maccCompat.idOf(entry.cookieStoreId);
      const route = normalize(entry.proxy);
      if (n && route && iso.identityExists(n)) next[String(n)] = route;
    }
    return next;
  }

  const routeKey = (n) => {
    const r = routes[String(n)];
    return r ? `${r.type}://${r.username}@${r.host}:${r.port}` : "direct";
  };
  const ctxsWithRoute = (key) => {
    const out = routeKey(0) === key ? ["0"] : [];
    for (const n of Object.keys(routes)) if (routeKey(n) === key) out.push(n);
    if (key === "direct") {
      for (const [, n] of iso.tabs) if (!routes[String(n)]) out.push(String(n));
    }
    return [...new Set(out)];
  };

  // -------------------------------------------------------------------------
  // helper (native messaging)
  // -------------------------------------------------------------------------
  function call(msg) {
    return new Promise((resolve, reject) => {
      if (!state.helper || !state.port) return reject(new Error("helper not running"));
      const id = ++msgId;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error("helper timeout"));
      }, 5000);
      waiting.set(id, (res) => { clearTimeout(timer); resolve(res); });
      state.helper.postMessage({ ...msg, id });
    });
  }

  function connectHelper() {
    clearTimeout(reconnectTimer);
    if (state.helper || !state.enabled) return;
    let port;
    try {
      port = chrome.runtime.connectNative(HOST);
    } catch (e) {
      state.error = String(e.message || e);
      scheduleReconnect();
      return;
    }
    state.helper = port;
    port.onMessage.addListener((msg) => {
      if (msg.type === "hello") {
        state.port = msg.port;
        state.version = msg.version;
        state.error = null;
        reconnectDelay = 1000;
        call({ type: "routes", routes }).then(applyProxySettings, () => {});
        return;
      }
      const cb = waiting.get(msg.id);
      if (cb) {
        waiting.delete(msg.id);
        cb(msg);
      }
    });
    port.onDisconnect.addListener(() => {
      state.error = (chrome.runtime.lastError && chrome.runtime.lastError.message) || "helper exited";
      state.helper = null;
      state.port = 0;
      waiting.forEach((cb) => cb({ error: state.error }));
      waiting.clear();
      clearProxySettings();
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (!state.enabled) return;
    reconnectTimer = setTimeout(connectHelper, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }

  // -------------------------------------------------------------------------
  // browser proxy settings
  // -------------------------------------------------------------------------
  function pac(port) {
    return `function FindProxyForURL(url, host) {
  if (isPlainHostName(host) || host === "localhost" || /^127\\./.test(host) || host === "[::1]") return "DIRECT";
  return "PROXY 127.0.0.1:${port}";
}`;
  }

  function setSetting(setting, value) {
    return new Promise((resolve) => {
      if (!setting) return resolve();
      setting.set({ value, scope: "regular" }, () => { lastError(); resolve(); });
    });
  }
  function clearSetting(setting) {
    return new Promise((resolve) => {
      if (!setting) return resolve();
      setting.clear({ scope: "regular" }, () => { lastError(); resolve(); });
    });
  }

  async function applyProxySettings() {
    if (!state.enabled || !state.port) return clearProxySettings();
    await setSetting(chrome.proxy.settings, { mode: "pac_script", pacScript: { data: pac(state.port), mandatory: true } });
    // WebRTC would otherwise send UDP around the proxy, and DNS prefetching
    // would resolve proxied hosts locally.
    const net = chrome.privacy && chrome.privacy.network;
    if (net) {
      await setSetting(net.webRTCIPHandlingPolicy, "disable_non_proxied_udp");
      await setSetting(net.networkPredictionEnabled, false);
    }
    await refreshControl();
  }

  async function clearProxySettings() {
    state.applied = false;
    await clearSetting(chrome.proxy.settings);
    const net = chrome.privacy && chrome.privacy.network;
    if (net) {
      await clearSetting(net.webRTCIPHandlingPolicy);
      await clearSetting(net.networkPredictionEnabled);
    }
  }

  function refreshControl() {
    return new Promise((resolve) => {
      chrome.proxy.settings.get({ incognito: false }, (details) => {
        lastError();
        state.control = details && details.levelOfControl;
        state.applied = !!details && details.levelOfControl === "controlled_by_this_extension"
          && details.value && details.value.mode === "pac_script";
        resolve();
      });
    });
  }
  chrome.proxy.settings.onChange.addListener(() => refreshControl());

  async function update() {
    routes = readRoutes();
    state.enabled = Object.keys(routes).length > 0;
    if (!state.enabled) {
      if (state.helper) state.helper.disconnect();
      state.helper = null;
      state.port = 0;
      await clearProxySettings();
      return;
    }
    if (!state.helper) connectHelper();
    else if (state.port) call({ type: "routes", routes }).then(applyProxySettings, () => {});
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.proxifiedContainersKey || changes.__macc_identities)) {
      // isolation.js updates its mirror from the same event; let it run first.
      setTimeout(update, 0);
    }
  });

  // -------------------------------------------------------------------------
  // tagging connections
  // -------------------------------------------------------------------------
  function siteOf(url) {
    try {
      const u = new URL(url);
      if (!/^(https?|wss?):$/.test(u.protocol)) return null;
      const domain = globalThis.tldts.getDomain(u.hostname, { allowPrivateDomains: true }) || u.hostname;
      const scheme = u.protocol === "https:" || u.protocol === "wss:" ? "https" : "http";
      return `${scheme}://${domain}`;
    } catch {
      return null;
    }
  }

  chrome.webRequest.onAuthRequired.addListener((d, callback) => {
    if (!d.isProxy || !state.port || !d.challenger || d.challenger.port !== state.port
        || !/^(127\.0\.0\.1|localhost)$/.test(d.challenger.host)) {
      callback({});
      return;
    }
    const n = iso.contextFor(d);
    const entry = tabSites.get(d.tabId);
    const site = d.type === "main_frame" ? siteOf(d.url)
      : (entry && entry.site) || siteOf(d.initiator || d.url) || "";
    call({ type: "token", ctx: String(n), site })
      .then((res) => callback(res.token
        ? { authCredentials: { username: "macc", password: res.token } }
        : { cancel: true }))
      .catch(() => callback({ cancel: true }));
  }, { urls: ["<all_urls>"] }, ["asyncBlocking"]);

  // -------------------------------------------------------------------------
  // fail closed
  // -------------------------------------------------------------------------
  const statusPage = (reason, url, extra = {}) => {
    const q = new URLSearchParams({ reason, url, ...extra });
    return chrome.runtime.getURL(`proxy-status.html?${q}`);
  };
  const usable = () => state.enabled && !!state.port && state.applied;

  // A proxied container must never fall back to a direct connection.
  chrome.webRequest.onBeforeRequest.addListener((d) => {
    if (!/^(https?|wss?):/.test(d.url)) return {};
    const n = iso.contextFor(d);
    if (!routes[String(n)] || usable()) return {};
    if (d.type === "main_frame") return { redirectUrl: statusPage("unavailable", d.url, { ctx: csidOf(n) }) };
    return { cancel: true };
  }, { urls: ["<all_urls>"] }, ["blocking"]);

  // -------------------------------------------------------------------------
  // one route per top-level site at a time
  // -------------------------------------------------------------------------
  const tabSites = new Map();     // tabId -> {site, route}
  const pendingFlush = new Map(); // "site|route" -> Promise

  function holders(site, route, exceptTab) {
    const out = [];
    for (const [tabId, e] of tabSites) {
      if (tabId !== exceptTab && e.site === site && (route === undefined || e.route === route)) out.push(tabId);
    }
    return out;
  }

  function release(tabId, entry) {
    if (!entry || !state.enabled) return;
    if (holders(entry.site, entry.route, tabId).length) return;
    const key = `${entry.site}|${entry.route}`;
    const p = call({ type: "flush", site: entry.site, ctxs: ctxsWithRoute(entry.route) })
      .catch(() => {})
      .finally(() => { if (pendingFlush.get(key) === p) pendingFlush.delete(key); });
    pendingFlush.set(key, p);
  }

  function setTabSite(tabId, site, route) {
    const before = tabSites.get(tabId);
    if (site) tabSites.set(tabId, { site, route });
    else tabSites.delete(tabId);
    if (before && (before.site !== site || before.route !== route)) release(tabId, before);
  }

  iso.navigationGuards.push((d, target) => {
    if (!state.enabled) return null;
    const site = siteOf(d.url);
    if (!site) return null;
    const route = routeKey(target);
    const others = holders(site, undefined, d.tabId).filter((t) => tabSites.get(t).route !== route);
    if (others.length) {
      const other = iso.containerOf(others[0]);
      return statusPage("conflict", d.url, { site, ctx: csidOf(target), other: csidOf(other), tab: String(others[0]) });
    }
    for (const [key] of pendingFlush) {
      const [s, r] = key.split("|");
      if (s === site && r !== route) return statusPage("wait", d.url, { site });
    }
    setTabSite(d.tabId, site, route);
    return null;
  });

  chrome.webNavigation.onCommitted.addListener((d) => {
    if (d.frameId !== 0) return;
    setTabSite(d.tabId, siteOf(d.url), routeKey(iso.containerOf(d.tabId)));
  });
  chrome.tabs.onRemoved.addListener((tabId) => setTabSite(tabId, null));
  iso.listeners.tabContainerChanged.push((tabId, n) => {
    const e = tabSites.get(tabId);
    if (e && n !== null) setTabSite(tabId, e.site, routeKey(n));
  });

  // -------------------------------------------------------------------------
  // status for proxy-status.html / options
  // -------------------------------------------------------------------------
  globalThis.__maccProxy = {
    status: () => ({
      enabled: state.enabled,
      helperRunning: !!state.port,
      version: state.version,
      applied: state.applied,
      control: state.control,
      error: state.error,
      host: HOST,
      extensionId: chrome.runtime.id,
      routes: Object.fromEntries(Object.entries(routes).map(([n, r]) => [n, `${r.type}://${r.host}:${r.port}`])),
    }),
    async waitFlushed(site) {
      const ps = [...pendingFlush].filter(([k]) => k.startsWith(`${site}|`)).map(([, p]) => p);
      await Promise.all(ps);
    },
    retry() {
      reconnectDelay = 1000;
      connectHelper();
    },
    holdersOf: (site) => holders(site),
    siteOf,
  };

  // Start once isolation.js has loaded storage.
  const start = () => (iso.mirror.__macc_identities ? update() : setTimeout(start, 100));
  start();
})();
