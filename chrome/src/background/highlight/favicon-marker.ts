/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The default highlight: the tab's favicon is redrawn with a line in the
// container's color down its left edge, so it shows in horizontal and
// vertical tab strips alike. favicon.ts asks for the marked icon; we fetch
// and composite it here.

import { colorCode, lastError } from "../../lib/constants";
import { fetchIcon, markedIconFrom } from "../icons";
import { iso } from "../isolation";
import { identity, settings } from "./settings";

const cache = new Map<string, string>(); // "href|color" -> data URL
const inflight = new Map<string, Promise<string>>();
const CACHE_SIZE = 300;

function markerColor(n: number): string | null {
  if (!settings().faviconMarker) return null;
  const rec = identity(n);
  return rec ? colorCode(rec.color) : null;
}

function markedIcon(href: string, color: string): Promise<string> {
  const key = `${href}|${color}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  // Tabs of one site load together: share one fetch + encode between them.
  let p = inflight.get(key);
  if (!p) {
    p = fetchIcon(href).then((blob) => markedIconFrom(blob, color)).then((url) => {
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
      cache.set(key, url);
      return url;
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

chrome.runtime.onMessage.addListener((msg: { __macc?: string; href?: string } | undefined, sender, respond) => {
  if (!msg || msg.__macc !== "favicon" || !sender.tab || sender.frameId !== 0) return undefined;
  const color = markerColor(iso.containerOf(sender.tab.id!));
  if (!color) {
    respond({ url: null });
    return undefined;
  }
  markedIcon(msg.href || "", color).then((url) => respond({ url }), () => respond({ url: null }));
  return true;
});

/**
 * Inject (or re-inject) favicon.js so the tab asks again: tabs opened before
 * the extension (re)started don't have the content script yet.
 */
export function refreshFavicon(tabId: number): void {
  chrome.tabs.executeScript(tabId, { file: "js/chrome/favicon.js" }, lastError);
}
