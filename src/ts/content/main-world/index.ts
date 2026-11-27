/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Runs in the page's main world at document_start, before the page's own
// scripts: script-visible storage follows the tab's container.
//   document.cookie / cookieStore -> `MACC<n>~` prefixed cookie names
//   localStorage / sessionStorage -> `MACC<n>~` prefixed keys
//   indexedDB, caches, BroadcastChannel -> `MACC<n>~` prefixed names
// Default (no container) pages see everything except prefixed entries.
//
// content/index.ts injects it as source (`import ... from "./main-world?script"`).

import { detect } from "./context";
import { patch } from "./patch";

export default function mainWorld(): void {
  patch(window, detect(window));
}
