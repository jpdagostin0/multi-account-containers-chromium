/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Reading history, newest first. A page of unfiltered results comes from
// one IDBIndex.getAllRecords() call (Chromium 141+) instead of a cursor
// round trip per row; text searches, and older Chromium, use a cursor.

import { req } from "../../lib/idb";
import { iso } from "../isolation";
import { containerRange, store, type Visit } from "./db";
import { iconsFor } from "./site-icons";

export interface Query { n?: number | null; text?: string; before?: number; limit?: number }

function scan(index: IDBIndex, range: IDBKeyRange, limit: number, keep: (v: Visit) => boolean): Promise<Visit[]> {
  const out: Visit[] = [];
  return new Promise((resolve, reject) => {
    const cur = index.openCursor(range, "prev");
    cur.onerror = () => reject(cur.error);
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c || out.length >= limit) return resolve(out);
      const v = c.value as Visit;
      if (keep(v)) out.push(v);
      c.continue();
    };
  });
}

async function page(index: IDBIndex, range: IDBKeyRange, limit: number, keep: (v: Visit) => boolean): Promise<Visit[] | null> {
  if (!index.getAllRecords) return null;
  const recs = await req(index.getAllRecords({ query: range, count: limit, direction: "prev" }));
  const values = recs.map((r) => r.value as Visit);
  const out = values.filter(keep);
  // Visits of removed containers are deleted with them, so this almost
  // never drops anything; if it does, the cursor still fills the page.
  return out.length === values.length ? out : null;
}

/**
 * n: container number, or null for all. text: matches title or URL.
 * before: time cursor for paging.
 */
export async function query({ n = null, text = "", before = Infinity, limit = 200 }: Query = {}) {
  const { os } = await store("visits");
  const needle = text.trim().toLowerCase();
  const range = n === null ? IDBKeyRange.upperBound(before, true) : containerRange(n, before);
  const index = n === null ? os.index("time") : os.index("n_time");
  const keep = (v: Visit) => iso.identityExists(v.n) && (!needle || v.url.toLowerCase().includes(needle)
    || (v.title || "").toLowerCase().includes(needle));

  const out = (!needle && await page(index, range, limit, keep)) || await scan(index, range, limit, keep);
  const originOf = (v: Visit) => new URL(v.url).origin;
  const icons = await iconsFor([...new Set(out.map(originOf))]);
  return out.map((v) => ({ ...v, icon: icons[originOf(v)] || null }));
}
