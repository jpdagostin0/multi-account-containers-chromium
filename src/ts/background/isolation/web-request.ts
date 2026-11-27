/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The webRequest side of isolation: cookie renaming, document tagging
// (Server-Timing) and navigation commits.

import { commitPending, onBeforeRequest } from "./assignment";
import { contextFor } from "./context";
import { filterCookieHeader, prefixSetCookie } from "./cookie-headers";
import { purgeListFor } from "./page-storage";
import { claimOrigin, swBlocked } from "./service-workers";
import { requestOverride } from "./state";
import { originOf } from "./urls";

const ALL: chrome.webRequest.RequestFilter = { urls: ["<all_urls>"] };
const DOCS: chrome.webRequest.RequestFilter = { urls: ["<all_urls>"], types: ["main_frame"] };

chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, DOCS, ["blocking"]);

chrome.webRequest.onBeforeSendHeaders.addListener((d) => {
  const n = contextFor(d);
  const headers = d.requestHeaders || [];
  let changed = false;
  let foreign = false;
  for (let i = headers.length - 1; i >= 0; i--) {
    const h = headers[i]!;
    if (h.name.length !== 6 || h.name.toLowerCase() !== "cookie") continue;
    const raw = h.value || "";
    const r = filterCookieHeader(raw, n);
    if (r.foreign) foreign = true;
    if (r.value !== raw) {
      changed = true;
      if (r.value) h.value = r.value;
      else headers.splice(i, 1);
    }
  }
  // The HTTP cache is shared. When another container holds cookies for this
  // URL, a cached copy may have been personalised for it: skip the cache
  // (Chromium treats a request `Cache-Control: no-cache` as a bypass).
  if (foreign) {
    const cc = headers.find((h) => h.name.toLowerCase() === "cache-control");
    if (cc) cc.value = "no-cache";
    else headers.push({ name: "Cache-Control", value: "no-cache" });
    changed = true;
  }
  return changed ? { requestHeaders: headers } : {};
}, ALL, ["blocking", "requestHeaders", "extraHeaders"]);

function tagDocument(d: chrome.webRequest.OnHeadersReceivedDetails, n: number, headers: chrome.webRequest.HttpHeader[], redirect: boolean): void {
  const origin = originOf(d.url);
  if (origin && !redirect) claimOrigin(origin, n);
  headers.push({ name: "Server-Timing", value: `macc;desc="${n}${swBlocked(origin, n) ? "|b" : ""}"` });
  const list = purgeListFor(d.url);
  if (list.length) {
    headers.push({ name: "Server-Timing", value: `maccpurge;desc="${list.map((p) => `${p.id}:${p.n}`).join(".")}"` });
  }
}

chrome.webRequest.onHeadersReceived.addListener((d) => {
  const n = contextFor(d);
  const headers = d.responseHeaders || [];
  let changed = false;
  if (n) {
    for (const h of headers) {
      if (h.value && h.name.length === 10 && h.name.toLowerCase() === "set-cookie") {
        h.value = prefixSetCookie(h.value, n);
        changed = true;
      }
    }
  }
  const redirect = d.statusCode >= 300 && d.statusCode < 400;
  if (d.type === "main_frame" || d.type === "sub_frame") {
    tagDocument(d, n, headers, redirect);
    changed = true;
  }
  // The response is about to commit: from here on the tab's own requests
  // belong to the new container.
  if (d.type === "main_frame" && d.tabId >= 0 && !redirect) commitPending(d.tabId);
  return changed ? { responseHeaders: headers } : {};
}, ALL, ["blocking", "responseHeaders", "extraHeaders"]);

// Overrides only exist for main-frame navigations: don't wake up for every
// subresource.
const forget = (d: { requestId: string }) => { requestOverride.delete(d.requestId); };
chrome.webRequest.onCompleted.addListener(forget, DOCS);
chrome.webRequest.onErrorOccurred.addListener(forget, DOCS);

chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId === 0) commitPending(d.tabId);
});
