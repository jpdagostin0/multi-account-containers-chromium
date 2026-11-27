/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Keeps the storage mirror current and reacts to containers being removed:
// like Firefox, their tabs close and all their data goes.

import { IDENT_KEY, csidOf, lastError, type IdentityState } from "../../lib/constants";
import { setBadge } from "./badge";
import { purgeCookies } from "./cookies";
import { purgeStorage } from "./page-storage";
import { persist } from "./persist";
import { mirror, tabs } from "./state";

const ids = (v: unknown) => new Set(((v as IdentityState | undefined)?.list ?? []).map((r) => r.id));

async function onIdentitiesChanged(change: chrome.storage.StorageChange): Promise<void> {
  const after = ids(change.newValue);
  for (const id of ids(change.oldValue)) {
    if (after.has(id)) continue;
    const doomed = [...tabs].filter(([, n]) => n === id).map(([tabId]) => tabId);
    doomed.forEach((t) => tabs.delete(t));
    if (doomed.length) chrome.tabs.remove(doomed, lastError);
    await purgeCookies(csidOf(id));
    await purgeStorage(csidOf(id));
  }
  for (const tabId of tabs.keys()) setBadge(tabId);
  persist();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const [k, v] of Object.entries(changes)) {
    if ("newValue" in v) mirror[k] = v.newValue;
    else delete mirror[k];
  }
  if (changes[IDENT_KEY]) onIdentitiesChanged(changes[IDENT_KEY]);
});
