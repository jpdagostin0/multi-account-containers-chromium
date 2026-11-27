/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// URL translation between Firefox and Chromium special pages.

import { base } from "./base";

const NEW_TAB_URLS = new Set(["chrome://newtab/", "chrome://new-tab-page/", "chrome://newtab"]);
const OWN_NEW_TAB = base.runtime.getURL("newtab.html");
const FIREFOX_NEW_TAB = new Set(["about:newtab", "about:home", "about:startpage"]);

/** A tab URL as Firefox would report it. */
export const firefoxUrl = (url: string) => (NEW_TAB_URLS.has(url) || url === OWN_NEW_TAB ? "about:newtab" : url);

/** A URL Firefox code wants to open, as Chromium understands it. */
export function chromeUrl(url: string | undefined): string | undefined {
  if (url === undefined || url === null) return url;
  return FIREFOX_NEW_TAB.has(url) ? "chrome://newtab/" : url;
}

export const isNetworkUrl = (url: unknown): url is string => typeof url === "string" && /^(https?|wss?|ftp):/i.test(url);
