/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The history database (extension IndexedDB "macc-history"). Writes use
// relaxed durability: no fsync per commit, fine for a browsing-history
// cache and much cheaper on every navigation.

import { req } from "../../lib/idb";

export interface Visit { id: number; n: number; url: string; title: string; time: number; transition: string }
export interface IconRec { origin: string; href: string; hash?: string; url: string; updated: number }
type StoreName = "visits" | "icons";

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const open = indexedDB.open("macc-history", 1);
    open.onupgradeneeded = () => {
      const d = open.result;
      const visits = d.createObjectStore("visits", { keyPath: "id", autoIncrement: true });
      visits.createIndex("time", "time");
      visits.createIndex("n_time", ["n", "time"]);
      visits.createIndex("url", "url");
      d.createObjectStore("icons", { keyPath: "origin" });
    };
    dbPromise = req(open);
  }
  return dbPromise;
}

export async function store(name: StoreName, mode: IDBTransactionMode = "readonly") {
  const tx = (await db()).transaction(name, mode, { durability: "relaxed" });
  return { tx, os: tx.objectStore(name) };
}

/** Container n's visits (n_time index) before a time. */
export const containerRange = (n: number, before = Infinity) =>
  IDBKeyRange.bound([n, -Infinity], [n, before], false, true);
