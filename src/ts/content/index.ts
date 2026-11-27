/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Content script, document_start in every frame: injects the main-world
// storage shim, then (top frame) reports the document's container.

import { setBorder } from "./border";
import mainWorld from "./main-world?script";
import { readMarker } from "./marker";
import { reportContext } from "./report";

// What this tab remembered before this load (session restore, SW pages);
// read before the main-world shim writes the new value.
const marker = readMarker();

const script = document.createElement("script");
script.textContent = `(${mainWorld})();`;
(document.documentElement || document).appendChild(script);
script.remove();

if (window === window.top) {
  window.__maccSetBorder = setBorder;
  reportContext(marker);
}
