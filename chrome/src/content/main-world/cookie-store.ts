/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The async Cookie Store API (and its change events), like document.cookie.

import type { Names } from "./names";
import { redefineGetter, type Realm } from "./realm";

export function patchCookieStore(win: Realm, { own, strip, wrap }: Names): void {
  const CS = win.CookieStore && win.CookieStore.prototype;
  if (!CS) return;
  const origGetAll = CS.getAll;
  const origSet = CS.set;
  const origDelete = CS.delete;
  const rename = (c: any) => (c && own(c.name) ? { ...c, name: strip(c.name) } : null);
  const getAll = async function (this: unknown, arg?: any) {
    const name = typeof arg === "string" ? arg : arg && arg.name;
    const url = arg && typeof arg === "object" ? arg.url : undefined;
    const list = await origGetAll.call(this, url ? { url } : undefined);
    return list.map(rename).filter((c: any) => c && (name === undefined || c.name === name));
  };
  CS.getAll = getAll;
  CS.get = async function (arg?: any) {
    return (await getAll.call(this, arg))[0] || null;
  };
  const named = (arg: any) => {
    if (typeof arg === "string") return wrap(arg);
    return { ...arg, name: wrap(String((arg && arg.name) || "")) };
  };
  CS.set = function (arg: any, value?: string) {
    return typeof arg === "string" ? origSet.call(this, wrap(arg), value) : origSet.call(this, named(arg));
  };
  CS.delete = function (arg: any) { return origDelete.call(this, named(arg)); };
  const CCE = win.CookieChangeEvent && win.CookieChangeEvent.prototype;
  for (const prop of ["changed", "deleted"]) {
    redefineGetter(CCE, prop, (get) => function (this: unknown) {
      return Object.freeze(get.call(this).map(rename).filter(Boolean));
    });
  }
}
