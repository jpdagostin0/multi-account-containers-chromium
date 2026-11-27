/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Renamer } from "./job";

/** Copy each source cache to its target name; returns how many moved. */
export async function moveCaches({ isSource, rename }: Renamer): Promise<number> {
  let n = 0;
  for (const name of (await caches.keys()).filter(isSource)) {
    const src = await caches.open(name);
    const dstName = rename(name);
    await caches.delete(dstName);
    const dst = await caches.open(dstName);
    await Promise.all((await src.keys()).map(async (r) => {
      const res = await src.match(r);
      if (res) await dst.put(r, res);
    }));
    await caches.delete(name);
    n++;
  }
  return n;
}
