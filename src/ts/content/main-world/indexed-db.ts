/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// indexedDB database names -> `MACC<n>~` prefixed.

import type { Names } from "./names";
import { redefineGetter, type Realm } from "./realm";

export function patchIndexedDB(win: Realm, { own, strip, wrap }: Names): void {
  const IF = win.IDBFactory && win.IDBFactory.prototype;
  if (!IF) return;
  const open = IF.open;
  const del = IF.deleteDatabase;
  const dbs = IF.databases;
  IF.open = function (name: string, ...rest: unknown[]) { return open.call(this, wrap(String(name)), ...rest); };
  IF.deleteDatabase = function (name: string) { return del.call(this, wrap(String(name))); };
  if (dbs) {
    IF.databases = async function () {
      return (await dbs.call(this)).filter((x: IDBDatabaseInfo) => own(x.name!))
        .map((x: IDBDatabaseInfo) => ({ ...x, name: strip(x.name!) }));
    };
  }
  redefineGetter(win.IDBDatabase.prototype, "name", (get) => function (this: unknown) { return strip(get.call(this)); });
}
