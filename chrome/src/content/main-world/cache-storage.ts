/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Cache Storage (`caches`) cache names -> `MACC<n>~` prefixed.

import type { Names } from "./names";
import type { Realm } from "./realm";

export function patchCacheStorage(win: Realm, { own, strip, wrap }: Names): void {
  const CSP = win.CacheStorage && win.CacheStorage.prototype;
  if (!CSP) return;
  const { open, has, keys } = CSP;
  const cdel = CSP.delete;
  CSP.open = function (name: string) { return open.call(this, wrap(String(name))); };
  CSP.has = function (name: string) { return has.call(this, wrap(String(name))); };
  CSP.delete = function (name: string) { return cdel.call(this, wrap(String(name))); };
  CSP.keys = async function () { return (await keys.call(this)).filter(own).map(strip); };
  CSP.match = async function (request: RequestInfo, options: MultiCacheQueryOptions = {}) {
    const names: string[] = options.cacheName !== undefined
      ? [String(options.cacheName)] : await CSP.keys.call(this);
    for (const name of names) {
      if (!(await has.call(this, wrap(name)))) continue;
      const cache: Cache = await open.call(this, wrap(name));
      const hit = await cache.match(request, options);
      if (hit) return hit;
    }
    return undefined;
  };
}
