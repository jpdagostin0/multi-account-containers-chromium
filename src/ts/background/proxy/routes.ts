/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Containers' proxies, read from Firefox's own "Advanced proxy settings" UI
// (stored by proxified-containers.js under `proxifiedContainersKey`).

import { idOf } from "../../lib/constants";
import { iso } from "../isolation";
import { state, type Route } from "./state";

interface FirefoxProxy {
  type?: string; host?: string; port?: string | number;
  username?: string; password?: string; proxyAuthorizationHeader?: string;
}

const DEFAULT_PORT: Record<string, number> = { http: 8080, https: 443, socks5: 1080, socks4: 1080 };

function credentials(proxy: FirefoxProxy): { username: string; password: string } {
  const header = proxy.proxyAuthorizationHeader;
  if (header && /^Basic /.test(header)) {
    try {
      const [username = "", ...p] = atob(header.slice(6)).split(":");
      return { username, password: p.join(":") };
    } catch { /* ignore malformed */ }
  }
  return { username: proxy.username || "", password: proxy.password || "" };
}

function normalize(proxy: FirefoxProxy | undefined): Route | null {
  if (!proxy || !proxy.type || !proxy.host) return null;
  const lower = String(proxy.type).toLowerCase();
  const type = lower === "socks" ? "socks5" : lower;
  if (!(type in DEFAULT_PORT)) return null;
  return { type, host: proxy.host, port: Number(proxy.port) || DEFAULT_PORT[type]!, ...credentials(proxy) };
}

export function readRoutes(): Record<string, Route> {
  const next: Record<string, Route> = {};
  const entries = (iso.mirror.proxifiedContainersKey || []) as { cookieStoreId: string; proxy?: FirefoxProxy }[];
  for (const entry of entries) {
    const n = idOf(entry.cookieStoreId);
    const route = normalize(entry.proxy);
    if (n && route && iso.identityExists(n)) next[String(n)] = route;
  }
  return next;
}

/** Identifies where container n's traffic goes. */
export const routeKey = (n: number | string): string => {
  const r = state.routes[String(n)];
  return r ? `${r.type}://${r.username}@${r.host}:${r.port}` : "direct";
};

/** Every container (as helper ctx strings) whose traffic goes the same way. */
export function ctxsWithRoute(key: string): string[] {
  const out = new Set<string>(routeKey(0) === key ? ["0"] : []);
  for (const n of Object.keys(state.routes)) if (routeKey(n) === key) out.add(n);
  if (key === "direct") {
    for (const n of iso.tabs.values()) if (!state.routes[String(n)]) out.add(String(n));
  }
  return [...out];
}
