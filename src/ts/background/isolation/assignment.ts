/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Top-level navigations: which container they commit to. Handles tabs
// created with a cookieStoreId, site assignments ("Always open in ..."),
// locked containers and guards from other modules, synchronously (Chromium
// ignores promises from blocking webRequest listeners).

import { csidOf, idOf } from "../../lib/constants";
import { containerOf, identityExists, mirror, pendingCommit, requestOverride, status } from "./state";
import { setTabN } from "./tabs";
import { isHttp, normalizeUrl, parse } from "./urls";

export interface Expectation { href: string; csid: string; at: number }
interface SiteAssignment { userContextId?: string; neverAsk?: boolean }

/** Tabs being created by tabs.create({cookieStoreId}), bound by URL. */
const expected = new Set<Expectation>();

export function expect(url: string, csid: string): Expectation {
  const e = { href: normalizeUrl(url), csid, at: Date.now() };
  expected.add(e);
  return e;
}
export const unexpect = (e: Expectation) => expected.delete(e);

function bindExpected(d: chrome.webRequest.OnBeforeRequestDetails): void {
  const href = normalizeUrl(d.url);
  for (const e of expected) {
    if (e.href === href && Date.now() - e.at < 10000) {
      expected.delete(e);
      setTabN(d.tabId, idOf(e.csid));
      return;
    }
  }
}

function isExempted(url: string, tabId: number): boolean {
  try {
    return !!globalThis.assignManager?.storageArea.isExempted(url, tabId);
  } catch {
    return false;
  }
}

function siteKey(u: URL): string {
  const port = u.port === "80" || u.port === "443" ? "" : u.port;
  return `siteContainerMap@@_${u.hostname}${port}`;
}

function confirmPage(url: string, wanted: number, current: number): string {
  let confirm = chrome.runtime.getURL("confirm-page.html")
    + `?url=${encodeURIComponent(url)}&cookieStoreId=${csidOf(wanted)}`;
  if (current) confirm += `&currentCookieStoreId=${csidOf(current)}`;
  return confirm;
}

function redirect(d: chrome.webRequest.OnBeforeRequestDetails, redirectUrl: string): chrome.webRequest.BlockingResponse {
  requestOverride.delete(d.requestId);
  pendingCommit.delete(d.tabId);
  return { redirectUrl };
}

export function onBeforeRequest(d: chrome.webRequest.OnBeforeRequestDetails): chrome.webRequest.BlockingResponse {
  if (d.tabId < 0 || d.frameId !== 0) return {};
  if (expected.size && d.type === "main_frame") bindExpected(d);
  if (!status.ready) return {};
  const u = parse(d.url);
  if (!u || !isHttp(u)) return {};
  const committed = containerOf(d.tabId);
  const current = requestOverride.get(d.requestId) ?? committed;
  let target = current;

  const site = mirror[siteKey(u)] as SiteAssignment | undefined;
  const wanted = site ? Number(site.userContextId) || 0 : 0;
  if (site && identityExists(wanted)) {
    if (wanted !== current && !isExempted(d.url, d.tabId)) {
      if (!site.neverAsk) return redirect(d, confirmPage(d.url, wanted, current));
      target = wanted;
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
  return {};
}

/** The navigation committed: the tab now belongs to its new container. */
export function commitPending(tabId: number): void {
  const n = pendingCommit.get(tabId);
  if (n === undefined) return;
  setTabN(tabId, n);
  pendingCommit.delete(tabId);
}
