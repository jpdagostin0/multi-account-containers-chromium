/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tab containers are saved to storage.local so they survive extension
// reloads and browser restarts (see restore.ts).

import { whenIdle } from "../../lib/constants";
import { base } from "../base";
import { tabs } from "./state";

export const STATE_KEY = "__macc_tabs";
export interface SavedTab { tabId: number; n: number; url: string }

let timer: ReturnType<typeof setTimeout> | undefined;

/** Debounced; one tabs.query for all tabs, run when the page is idle. */
export function persist(): void {
  clearTimeout(timer);
  timer = setTimeout(() => whenIdle(async () => {
    const open = new Map((await base.tabs.query({})).map((t) => [t.id!, t as chrome.tabs.Tab]));
    const entries: SavedTab[] = [];
    for (const [tabId, n] of tabs) {
      const t = open.get(tabId);
      if (!t) tabs.delete(tabId);
      else if (!t.incognito) entries.push({ tabId, n, url: t.url || t.pendingUrl || "" });
    }
    chrome.storage.local.set({ [STATE_KEY]: entries });
  }), 500);
}
