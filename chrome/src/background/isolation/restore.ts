/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Restores tab containers at startup from what persist.ts saved.

import { base } from "../base";
import { setBadge } from "./badge";
import { STATE_KEY, persist, type SavedTab } from "./persist";
import { identityExists, mirror, recentReloads, startup, tabs } from "./state";
import { reloadTab } from "./tabs";

export async function restore(): Promise<void> {
  const saved: SavedTab[] = mirror[STATE_KEY] || [];
  const open = await base.tabs.query({}) as chrome.tabs.Tab[];
  startup.tabs = new Set(open.map((t) => t.id!));
  const used = new Set<number>();
  const take = (t: chrome.tabs.Tab, match: (e: SavedTab) => boolean): boolean => {
    const i = saved.findIndex((e, idx) => !used.has(idx) && match(e));
    if (i < 0 || !identityExists(saved[i]!.n)) return false;
    used.add(i);
    tabs.set(t.id!, saved[i]!.n);
    return true;
  };
  // Extension reload: tab ids survive, keep them as-is.
  for (const t of open) take(t, (e) => e.tabId === t.id && e.url === t.url);
  // Browser restart: pages report their container from sessionStorage
  // (see page-context.ts); this URL match covers the rest, e.g. discarded
  // tabs that haven't run any script yet.
  const toReload: number[] = [];
  for (const t of open) {
    if (tabs.has(t.id!)) continue;
    if (take(t, (e) => !!e.url && e.url === t.url) && !t.discarded && /^https?:/.test(t.url || "")) {
      toReload.push(t.id!);
    }
  }
  for (const t of open) setBadge(t.id!);
  for (const id of toReload) {
    recentReloads.set(id, Date.now());
    reloadTab(id);
  }
  persist();
}
