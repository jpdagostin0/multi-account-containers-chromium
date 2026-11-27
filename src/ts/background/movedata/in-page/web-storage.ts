/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Renamer } from "./job";

/** Rename the source keys of one storage area; returns how many moved. */
export function moveWebStorage(store: Storage, { isSource, rename }: Renamer): number {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) keys.push(store.key(i)!);
  let n = 0;
  for (const k of keys.filter(isSource)) {
    store.setItem(rename(k), store.getItem(k)!);
    store.removeItem(k);
    n++;
  }
  return n;
}
