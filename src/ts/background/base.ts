/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The unwrapped webextension-polyfill namespace (compat.ts loads first and
// keeps it). Use it for promise-style calls: Chromium only returns promises
// from chrome.* in Manifest V3, and this is an MV2 extension.
export const base = globalThis.__maccCompat.base;
