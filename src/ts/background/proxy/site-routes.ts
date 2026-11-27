/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Chromium pools connections per top-level site, not per tab, so one tunnel
// could carry requests of two containers that have the same site open. Fail
// closed: a site can't be open at the same time in containers that route
// differently, and the tunnels of a (site, route) pair are closed before
// that site is opened under another route.

import { csidOf } from "../../lib/constants";
import { iso } from "../isolation";
import { call } from "./helper";
import { ctxsWithRoute, routeKey } from "./routes";
import { siteOf } from "./site";
import { state } from "./state";
import { statusPage } from "./status-page";

interface TabSite { site: string; route: string }

/** tabId -> the site its top frame shows and how that site is routed */
export const tabSites = new Map<number, TabSite>();
/** "site|route" -> tunnels being closed */
const pendingFlush = new Map<string, Promise<unknown>>();

export function holders(site: string, route?: string, exceptTab?: number): number[] {
  const out: number[] = [];
  for (const [tabId, e] of tabSites) {
    if (tabId !== exceptTab && e.site === site && (route === undefined || e.route === route)) out.push(tabId);
  }
  return out;
}

function release(tabId: number, entry: TabSite): void {
  if (!state.enabled || holders(entry.site, entry.route, tabId).length) return;
  const key = `${entry.site}|${entry.route}`;
  const p: Promise<unknown> = call({ type: "flush", site: entry.site, ctxs: ctxsWithRoute(entry.route) })
    .catch(() => {})
    .finally(() => { if (pendingFlush.get(key) === p) pendingFlush.delete(key); });
  pendingFlush.set(key, p);
}

function setTabSite(tabId: number, site: string | null, route?: string): void {
  const before = tabSites.get(tabId);
  if (site) tabSites.set(tabId, { site, route: route! });
  else tabSites.delete(tabId);
  if (before && (before.site !== site || before.route !== route)) release(tabId, before);
}

export async function waitFlushed(site: string): Promise<void> {
  await Promise.all([...pendingFlush].filter(([k]) => k.startsWith(`${site}|`)).map(([, p]) => p));
}

iso.navigationGuards.push((d, target) => {
  if (!state.enabled) return null;
  const site = siteOf(d.url);
  if (!site) return null;
  const route = routeKey(target);
  const other = holders(site, undefined, d.tabId).find((t) => tabSites.get(t)!.route !== route);
  if (other !== undefined) {
    return statusPage("conflict", d.url, {
      site, ctx: csidOf(target), other: csidOf(iso.containerOf(other)), tab: String(other),
    });
  }
  for (const key of pendingFlush.keys()) {
    const [s, r] = key.split("|");
    if (s === site && r !== route) return statusPage("wait", d.url, { site });
  }
  setTabSite(d.tabId, site, route);
  return null;
});

chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId === 0) setTabSite(d.tabId, siteOf(d.url), routeKey(iso.containerOf(d.tabId)));
});
chrome.tabs.onRemoved.addListener((tabId) => setTabSite(tabId, null));
iso.listeners.tabContainerChanged.push((tabId, n) => {
  const e = tabSites.get(tabId);
  if (e && n !== null) setTabSite(tabId, e.site, routeKey(n));
});
