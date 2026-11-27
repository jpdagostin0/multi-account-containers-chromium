/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Access to the background page, which owns all state.

import type { BackgroundWindow } from "../lib/globals";

export const isBackground = location.pathname === "/js/background/index.html";

let bgWindow: BackgroundWindow | null = null;
export function bg(): BackgroundWindow {
  if (isBackground) return globalThis as unknown as BackgroundWindow;
  if (!bgWindow || bgWindow.closed) {
    bgWindow = chrome.extension.getBackgroundPage() as BackgroundWindow | null;
    if (!bgWindow) throw new Error("Multi-Account Containers background page is not available");
  }
  return bgWindow;
}

export const iso = () => bg().__maccIso;

// Values cross realms (popup <-> background page); a structured clone keeps
// one page's objects from pinning another's.
export const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
