/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Deleting history: single visits, a container's, everything, and entries
// past the retention period. Bulk deletes collect primary keys with one
// getAllKeys() per range rather than walking a cursor.

import { IDENT_KEY, type IdentityState } from "../../lib/constants";
import { done, req } from "../../lib/idb";
import { containerRange, store } from "./db";

const RETENTION_DAYS = 90;

export async function remove(ids: number[]): Promise<void> {
  const { tx, os } = await store("visits", "readwrite");
  ids.forEach((id) => os.delete(id));
  await done(tx);
}

async function deleteRanges(indexName: "time" | "n_time", ranges: IDBKeyRange[]): Promise<void> {
  const { tx, os } = await store("visits", "readwrite");
  const index = os.index(indexName);
  await Promise.all(ranges.map(async (range) => {
    for (const k of await req(index.getAllKeys(range))) os.delete(k);
  }));
  await done(tx);
}

/** n: one container, or null for all. */
export async function clear(n: number | null): Promise<void> {
  if (n !== null) return deleteRanges("n_time", [containerRange(n)]);
  const { tx, os } = await store("visits", "readwrite");
  os.clear();
  await done(tx);
}

export function prune(): Promise<void> {
  return deleteRanges("time", [IDBKeyRange.upperBound(Date.now() - RETENTION_DAYS * 864e5)]);
}

// Removing a container drops its history.
chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[IDENT_KEY];
  if (area !== "local" || !change) return;
  const list = (v: unknown) => (v as IdentityState | undefined)?.list ?? [];
  const live = new Set(list(change.newValue).map((r) => r.id));
  const gone = list(change.oldValue).filter((r) => !live.has(r.id)).map((r) => r.id);
  if (gone.length) deleteRanges("n_time", gone.map((n) => containerRange(n))).catch(() => {});
});
