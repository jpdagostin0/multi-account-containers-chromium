/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// An optional colored frame around the page itself, drawn by
// content/border.ts.

import { colorCode, lastError } from "../../lib/constants";
import { iso } from "../isolation";
import { identity, settings } from "./settings";

function borderColor(n: number): string | null {
  if (!settings().pageBorder) return null;
  const rec = identity(n);
  return rec ? colorCode(rec.color) : null;
}

export const borderColorForTab = (tabId: number) => borderColor(iso.containerOf(tabId));

export function applyBorder(tabId: number): void {
  chrome.tabs.executeScript(tabId, {
    code: `window.__maccSetBorder && window.__maccSetBorder(${JSON.stringify(borderColorForTab(tabId))})`,
    runAt: "document_start",
  }, lastError);
}

// Pages ask for their border when they load.
iso.hooks.borderColorForTab = borderColorForTab;
