/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Search for the new tab page: the chosen engine, its suggestions, and
// matching open tabs.

import { base } from "../base";
import { engine, fillTemplate, PRESETS, setEngine } from "./engine";
import { suggest, tabs } from "./suggest";

export type { Engine } from "./engine";
export type { TabMatch } from "./suggest";

export const search = {
  engine,
  setEngine,
  presets: PRESETS,
  suggest,
  tabs,
  /** The engine's results page for text, or null to let chrome.search pick. */
  async resultsUrl(text: string): Promise<string | null> {
    const e = await engine();
    return e ? fillTemplate(e.url, text) : null;
  },
  /** Bring an open tab to the front. */
  async switchTo(tabId: number, windowId: number): Promise<void> {
    await base.tabs.update(tabId, { active: true });
    await base.windows.update(windowId, { focused: true });
  },
};
export type SearchApi = typeof search;
