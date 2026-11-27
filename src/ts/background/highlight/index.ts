/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Container highlighting for Chromium (background page): Firefox draws a
// colored line on container tabs; Chromium extensions can't style tabs, so
// there are two opt-in options: tab-groups.ts and page-border.ts (plus the
// toolbar badge, isolation/badge.ts).

import { IDENT_KEY, SETTINGS_KEY } from "../../lib/constants";
import { base } from "../base";
import { fetchIcon, plainIcon } from "../icons";
import { iso } from "../isolation";
import { COMPANION, companion, pingCompanion } from "./companion";
import { applyBorder, borderColorForTab } from "./page-border";
import { setSettings, settings } from "./settings";
import { adoptExistingGroups, groupOf, restyleGroups, scheduleGroupSync } from "./tab-groups";

function highlightTab(tabId: number): void {
  scheduleGroupSync(tabId);
  applyBorder(tabId);
}

async function syncAll(): Promise<void> {
  await pingCompanion();
  await adoptExistingGroups();
  for (const t of await base.tabs.query({})) highlightTab(t.id!);
}

iso.listeners.tabContainerChanged.push((tabId, n) => {
  if (n !== null) highlightTab(tabId);
});
chrome.management.onEnabled.addListener((info) => { if (info.id === COMPANION) syncAll(); });
chrome.management.onInstalled.addListener((info) => { if (info.id === COMPANION) syncAll(); });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[SETTINGS_KEY]) setTimeout(syncAll, 0);
  if (changes[IDENT_KEY]) {
    setTimeout(async () => {
      restyleGroups();
      for (const t of await base.tabs.query({})) applyBorder(t.id!);
    }, 0);
  }
});

export const highlight = {
  status: () => ({ ...settings(), companion: { ...companion }, companionId: COMPANION }),
  borderColorForTab,
  setSettings,
  syncAll,
  plainIcon,
  fetchIcon,
  groupOf,
};
export type HighlightApi = typeof highlight;

iso.ready.then(() => setTimeout(syncAll, 500));
