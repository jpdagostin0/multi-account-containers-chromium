/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Browser } from "webextension-polyfill";

/**
 * The Firefox-style `browser` namespace (webextension-polyfill, wrapped by
 * compat.ts). @types/chrome declares the global `browser` as `typeof chrome`,
 * so read it through the polyfill's own types instead.
 */
export const ff = (): Browser => (globalThis as unknown as { browser: Browser }).browser;
