/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Helpers for patching a window's (a "realm's") built-in prototypes.

/** A window object whose built-ins we patch; typed loosely on purpose. */
export type Realm = any;

export const desc = (obj: object | undefined, prop: PropertyKey) =>
  (obj ? Object.getOwnPropertyDescriptor(obj, prop) : undefined);

/** Replace a prototype getter with one built from the original. */
export function redefineGetter(proto: object | undefined, prop: string, make: (get: () => any) => () => any): void {
  const d = desc(proto, prop);
  if (!proto || !d || !d.get) return;
  Object.defineProperty(proto, prop, { ...d, get: make(d.get) });
}
