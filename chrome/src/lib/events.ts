/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// A minimal WebExtension-style event for APIs we emulate.

export type Listener = (...args: any[]) => unknown;

export interface FakeEvent<F extends Listener> {
  addListener(fn: F): void;
  removeListener(fn: F): void;
  hasListener(fn: F): boolean;
  _fire(...args: Parameters<F>): void;
}

export function makeEvent<F extends Listener>(): FakeEvent<F> {
  const listeners = new Set<F>();
  return {
    addListener: (fn) => { listeners.add(fn); },
    removeListener: (fn) => { listeners.delete(fn); },
    hasListener: (fn) => listeners.has(fn),
    _fire(...args) {
      for (const fn of listeners) {
        try {
          const r = fn(...args) as Promise<unknown> | undefined;
          if (r && typeof r.catch === "function") r.catch((e) => console.error(e));
        } catch (e) {
          console.error(e);
        }
      }
    },
  };
}
