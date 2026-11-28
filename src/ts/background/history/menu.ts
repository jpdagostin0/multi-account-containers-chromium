/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Toolbar button context menu → a new tab with the history drawer open (at the tab's container).

import { iso } from "../isolation";

const MENU = "macc-history";

chrome.contextMenus.create({ id: MENU, title: "History by container", contexts: ["browser_action"] },
  () => void chrome.runtime.lastError);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU) return;
  const n = tab?.id !== undefined ? iso.containerOf(tab.id) : null;
  chrome.tabs.create({
    url: chrome.runtime.getURL(`newtab.html#history${n ? `=${n}` : ""}`),
    index: tab ? tab.index + 1 : undefined,
  });
});
