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
// The background page owns all state (background/isolation exposes it as
// window.__maccIso); other pages reach it through getBackgroundPage().

import type { Browser } from "webextension-polyfill";
import { COLORS, CPREFIX, DEFAULT, IDENT_KEY, SEED, csidOf, idOf } from "../lib/constants";
import { isBackground } from "./background";
import { base } from "./base";
import { browsingData } from "./browsing-data";
import { contextMenus } from "./context-menus";
import { ciImpl, contextualIdentities } from "./identities";
import type { AnyRecord } from "./overlay";
import { runtime } from "./runtime";
import { browserAction, commands, i18n } from "./stubs";
import { tabs } from "./tabs";
import { webRequest } from "./web-request";
import { windows } from "./windows";

const overrides: AnyRecord = {
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
};

(globalThis as unknown as { browser: Browser }).browser = new Proxy(base, {
  get: (target, prop) => (prop in overrides ? overrides[prop] : (target as AnyRecord)[prop]),
  has: (target, prop) => (prop in overrides ? overrides[prop] !== undefined : prop in target),
});

const compat = {
  ci: ciImpl,
  DEFAULT,
  CPREFIX,
  IDENT_KEY,
  COLORS,
  SEED,
  idOf,
  csidOf,
  /** The unwrapped webextension-polyfill namespace. */
  base,
  isBackground,
};
export type CompatApi = typeof compat;
globalThis.__maccCompat = compat;
