/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Right-click the page or the toolbar button →
// "Move this site's data to container" → target.

import { IDENT_KEY, csidOf, lastError } from "../../lib/constants";
import { iso } from "../isolation";
import { moveSiteData } from "./move";

const MENU = "macc-move-data";
const CONTEXTS = ["page", "frame", "browser_action"] as chrome.contextMenus.CreateProperties["contexts"];

let building: Promise<void> = Promise.resolve();
export function buildMenu(): Promise<void> {
  building = building.then(() => new Promise<void>((resolve) => {
    chrome.contextMenus.remove(MENU, () => {
      lastError();
      chrome.contextMenus.create({ id: MENU, title: "Move this site's data to container", contexts: CONTEXTS }, lastError);
      for (const t of [{ id: 0, name: "No container" }, ...iso.identities()]) {
        chrome.contextMenus.create({ id: `${MENU}:${csidOf(t.id)}`, parentId: MENU, title: t.name, contexts: CONTEXTS }, lastError);
      }
      resolve();
    });
  }));
  return building;
}

function notify(tabId: number, text: string): void {
  chrome.tabs.executeScript(tabId, {
    code: `setTimeout(() => console.info(${JSON.stringify(`Multi-Account Containers: ${text}`)}), 0)`,
  }, lastError);
  chrome.browserAction.setBadgeText({ tabId, text: "✓" }, lastError);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || typeof info.menuItemId !== "string" || !info.menuItemId.startsWith(`${MENU}:`)) return;
  try {
    const r: { site: string; cookies: number; localStorage?: number; indexedDB?: number; caches?: number; errors?: string[] }
      = await moveSiteData(tab.id, info.menuItemId.slice(MENU.length + 1));
    notify(tab.id, `moved ${r.site}: ${r.cookies} cookies, ${r.localStorage || 0} localStorage keys, `
      + `${r.indexedDB || 0} databases, ${r.caches || 0} caches${r.errors?.length ? ` (errors: ${r.errors.join("; ")})` : ""}`);
  } catch (e) {
    console.warn("macc: move failed", e);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[IDENT_KEY]) setTimeout(buildMenu, 0);
});
