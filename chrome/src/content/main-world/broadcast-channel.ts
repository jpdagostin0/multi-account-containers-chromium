/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// BroadcastChannel names -> `MACC<n>~` prefixed (containers only).

import type { Names } from "./names";
import { redefineGetter, type Realm } from "./realm";

export function patchBroadcastChannel(win: Realm, { pre, strip, wrap }: Names): void {
  if (!win.BroadcastChannel || !pre) return;
  const BC = win.BroadcastChannel;
  redefineGetter(BC.prototype, "name", (get) => function (this: unknown) { return strip(get.call(this)); });
  win.BroadcastChannel = new win.Proxy(BC, {
    construct(t: any, args: unknown[], nt: any) {
      return Reflect.construct(t, [wrap(String(args[0])), ...args.slice(1)], nt);
    },
  });
}
