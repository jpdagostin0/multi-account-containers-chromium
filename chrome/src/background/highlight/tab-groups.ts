/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Each container's tabs sit in one tab group per window, named and colored
// after the container (opt-in).

import { lastError } from "../../lib/constants";
import { base } from "../base";
import { iso } from "../isolation";
import { ask, companion, type CompanionGroup } from "./companion";
import { identity, settings } from "./settings";

// Container colors -> Chromium tab group colors (same palette names).
const GROUP_COLOR: Record<string, string> = {
  blue: "blue", turquoise: "cyan", green: "green", yellow: "yellow",
  orange: "orange", red: "red", pink: "pink", purple: "purple", toolbar: "grey",
};
const groupColor = (c: string) => GROUP_COLOR[c] || "grey";

/** "windowId:n" -> groupId of the group we made for that container */
const groups = new Map<string, number>();
const queue = new Map<number, Promise<void>>(); // tabId -> pending sync
let busy: Promise<void> = Promise.resolve();

export const groupOf = (windowId: number, n: number) => groups.get(`${windowId}:${n}`);

const tabsInGroup = (groupId: number): Promise<chrome.tabs.Tab[]> =>
  new Promise((resolve) => chrome.tabs.query({ groupId }, (l) => { lastError(); resolve(l || []); }));

async function styleGroup(groupId: number, n: number): Promise<void> {
  const rec = identity(n);
  if (!rec) return;
  await ask({ op: "update", groupId, props: { title: rec.name, color: groupColor(rec.color) } });
}

function group(options: chrome.tabs.GroupOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.tabs.group(options, (id) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(id);
    });
  });
}

async function groupFor(windowId: number, n: number, tabId: number): Promise<number> {
  const key = `${windowId}:${n}`;
  const existing = groups.get(key);
  if (existing !== undefined && (await tabsInGroup(existing)).some((t) => t.windowId === windowId)) {
    await group({ groupId: existing, tabIds: [tabId] }).catch(() => {});
    return existing;
  }
  const groupId = await group({ tabIds: [tabId], createProperties: { windowId } });
  groups.set(key, groupId);
  await styleGroup(groupId, n).catch(() => {});
  return groupId;
}

async function syncTab(tabId: number): Promise<void> {
  let tab: chrome.tabs.Tab;
  try { tab = await base.tabs.get(tabId) as chrome.tabs.Tab; } catch { return; }
  const n = iso.containerOf(tabId);
  const inOurs = tab.groupId !== undefined && tab.groupId >= 0 && new Set(groups.values()).has(tab.groupId);
  if (!settings().tabGroups || !companion.available || !identity(n)) {
    if (inOurs) await new Promise<void>((r) => chrome.tabs.ungroup(tabId, () => { lastError(); r(); }));
    return;
  }
  if (tab.pinned) return; // pinned tabs can't be grouped
  if (tab.groupId >= 0 && !inOurs) return; // the user's own group: leave it
  if (inOurs && groupOf(tab.windowId, n) === tab.groupId) return;
  await groupFor(tab.windowId, n, tabId).catch(() => {});
}

/** Sync one tab's group; calls are serialized. */
export function scheduleGroupSync(tabId: number): Promise<void> {
  const queued = queue.get(tabId);
  if (queued) return queued;
  const p = busy = busy.then(() => syncTab(tabId)).catch(() => {}).finally(() => queue.delete(tabId));
  queue.set(tabId, p);
  return p;
}

/** After a restart, reuse groups that already carry a container's name. */
export async function adoptExistingGroups(): Promise<void> {
  if (!companion.available) return;
  let found: CompanionGroup[] = [];
  try { found = (await ask({ op: "query", query: {} })).groups || []; } catch { return; }
  const list = iso.identities();
  for (const g of found) {
    const rec = list.find((r) => r.name === g.title && groupColor(r.color) === g.color);
    if (rec && !groups.has(`${g.windowId}:${rec.id}`)) groups.set(`${g.windowId}:${rec.id}`, g.id);
  }
}

/** Containers were renamed or recolored. */
export function restyleGroups(): void {
  for (const [key, gid] of groups) {
    const n = Number(key.split(":")[1]);
    if (identity(n)) styleGroup(gid, n).catch(() => {});
  }
}

chrome.tabs.onAttached.addListener((tabId) => { scheduleGroupSync(tabId); });
chrome.tabs.onUpdated.addListener((tabId, info) => {
  // Pulled out of its container group (drag, sort, unpin...): put it back.
  if (("groupId" in info || "pinned" in info) && iso.containerOf(tabId)) scheduleGroupSync(tabId);
});
chrome.tabs.onRemoved.addListener(() => {
  for (const [key, gid] of groups) {
    tabsInGroup(gid).then((l) => { if (!l.length && groups.get(key) === gid) groups.delete(key); });
  }
});
