/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The background page's modules, for extension pages.

import type { BackgroundWindow } from "../lib/globals";

export const backgroundPage = (): BackgroundWindow =>
  chrome.extension.getBackgroundPage() as BackgroundWindow;
