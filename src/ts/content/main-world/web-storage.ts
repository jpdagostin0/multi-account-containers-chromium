/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// localStorage / sessionStorage -> `MACC<n>~` prefixed keys, including
// property-style access (localStorage.foo) through a Proxy per storage area.

import type { Names } from "./names";
import { desc, redefineGetter, type Realm } from "./realm";

export function patchWebStorage(win: Realm, { own, strip, wrap }: Names): void {
  const SP = win.Storage.prototype;
  const o = {
    getItem: SP.getItem, setItem: SP.setItem, removeItem: SP.removeItem,
    key: SP.key, length: desc(SP, "length")!.get!,
  };
  const realOf = new WeakMap<object, Storage>();
  const R = (s: Storage) => realOf.get(s) || s;
  const keys = (s: Storage) => {
    const r = R(s);
    const out: string[] = [];
    const len = o.length.call(r);
    for (let i = 0; i < len; i++) {
      const k = o.key.call(r, i);
      if (k !== null && own(k)) out.push(strip(k));
    }
    return out;
  };
  SP.getItem = function (k: string) { return o.getItem.call(R(this), wrap(String(k))); };
  SP.setItem = function (k: string, v: string) { return o.setItem.call(R(this), wrap(String(k)), v); };
  SP.removeItem = function (k: string) { return o.removeItem.call(R(this), wrap(String(k))); };
  SP.clear = function () {
    const r = R(this);
    for (const k of keys(r)) o.removeItem.call(r, wrap(k));
  };
  SP.key = function (i: number) {
    const ks = keys(this);
    const idx = Number(i) || 0;
    return idx >= 0 && idx < ks.length ? ks[idx] : null;
  };
  Object.defineProperty(SP, "length", {
    ...desc(SP, "length"),
    get() { return keys(this).length; },
  });

  const isMember = (p: PropertyKey) => typeof p === "symbol" || p in SP;
  const proxyFor = (real: Storage) => {
    const p: Storage = new win.Proxy(real, {
      get(t: Storage, prop: PropertyKey) {
        if (isMember(prop)) {
          const v = Reflect.get(t, prop, p);
          return typeof v === "function" ? v.bind(p) : v;
        }
        const v = SP.getItem.call(t, prop);
        return v === null ? undefined : v;
      },
      set(t: Storage, prop: PropertyKey, v: unknown) {
        if (typeof prop === "symbol") return Reflect.set(t, prop, v);
        SP.setItem.call(t, prop, v);
        return true;
      },
      has(t: Storage, prop: PropertyKey) {
        if (isMember(prop)) return prop in t;
        return SP.getItem.call(t, prop) !== null;
      },
      deleteProperty(t: Storage, prop: PropertyKey) {
        if (typeof prop !== "symbol") SP.removeItem.call(t, prop);
        return true;
      },
      defineProperty(t: Storage, prop: PropertyKey, d: PropertyDescriptor) {
        if (typeof prop !== "symbol") SP.setItem.call(t, prop, d.value);
        return true;
      },
      ownKeys(t: Storage) { return keys(t); },
      getOwnPropertyDescriptor(t: Storage, prop: PropertyKey) {
        if (typeof prop === "symbol") return undefined;
        const v = SP.getItem.call(t, prop);
        return v === null ? undefined : { value: v, writable: true, enumerable: true, configurable: true };
      },
    });
    realOf.set(p, real);
    return p;
  };
  for (const prop of ["localStorage", "sessionStorage"]) {
    const holder = desc(win, prop) ? win : win.Window.prototype;
    const d = desc(holder, prop);
    if (!d || !d.get) continue;
    let cached: Storage | null = null;
    Object.defineProperty(holder, prop, {
      ...d,
      get() {
        const real = d.get!.call(this);
        if (!real) return real;
        if (!cached || realOf.get(cached) !== real) cached = proxyFor(real);
        return cached;
      },
    });
  }
  redefineGetter(win.StorageEvent && win.StorageEvent.prototype, "key", (get) => function (this: unknown) {
    const k = get.call(this);
    return k !== null && own(k) ? strip(k) : k;
  });
}
