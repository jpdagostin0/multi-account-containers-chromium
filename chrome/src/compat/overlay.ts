/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

export type AnyRecord = Record<PropertyKey, any>;

/** `target` with some properties replaced. */
export function overlay<T extends object>(target: T, overrides: AnyRecord): T {
  return new Proxy(target, {
    get: (t, prop) => (prop in overrides ? overrides[prop] : (t as AnyRecord)[prop]),
  });
}
