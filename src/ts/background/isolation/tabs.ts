/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Which container each tab is in, and how that follows tab events.

import { lastError } from "../../lib/constants";
import { setBadge } from "./badge";
import { persist } from "./persist";
import { containerOf, listeners, pendingCommit, tabs } from "./state";

export function setTabN(tabId: number, n: number): void {
  const before = containerOf(tabId);
  if (n) tabs.set(tabId, n);
  else tabs.delete(tabId);
  setBadge(tabId);
  persist();
  if (before !== n) listeners.tabContainerChanged.forEach((fn) => fn(tabId, n, before));
}

export const reloadTab = (tabId: number) => chrome.tabs.reload(tabId, { bypassCache: true }, lastError);

// Tabs opened from a container tab stay in its container.
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id === undefined || tabs.has(tab.id)) return;
  if (tab.openerTabId !== undefined && tabs.has(tab.openerTabId)) setTabN(tab.id, tabs.get(tab.openerTabId)!);
});
chrome.webNavigation.onCreatedNavigationTarget.addListener((d) => {
  if (!tabs.has(d.tabId) && tabs.has(d.sourceTabId)) setTabN(d.tabId, tabs.get(d.sourceTabId)!);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const before = containerOf(tabId);
  tabs.delete(tabId);
  pendingCommit.delete(tabId);
  persist();
  listeners.tabContainerChanged.forEach((fn) => fn(tabId, null, before));
});
chrome.tabs.onReplaced.addListener((added, removed) => {
  if (!tabs.has(removed)) return;
  tabs.set(added, tabs.get(removed)!);
  tabs.delete(removed);
  setBadge(added);
  persist();
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) persist();
  if (info.status === "loading" && tabs.has(tabId)) setBadge(tabId);
});
