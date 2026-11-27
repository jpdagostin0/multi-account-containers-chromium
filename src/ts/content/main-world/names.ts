/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Name mapping for one container: container n's entries are stored as
// `MACC<n>~name`; the default context sees only unprefixed names.

export const ANY = /^MACC\d+~/;

export interface Names {
  pre: string | null;
  /** Does this raw name belong to the context? */
  own(name: string): boolean;
  /** Raw name -> name the page sees. */
  strip(name: string): string;
  /** Name the page uses -> raw name. */
  wrap(name: string): string;
}

export function namesFor(n: number): Names {
  const pre = n ? `MACC${n}~` : null;
  return {
    pre,
    own: (name) => (pre ? name.startsWith(pre) : !ANY.test(name)),
    strip: (name) => (pre ? name.slice(pre.length) : name),
    wrap: (name) => (pre ? pre + name : name),
  };
}
