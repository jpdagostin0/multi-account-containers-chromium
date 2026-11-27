/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// A page can touch an about:blank iframe or popup before our content script
// runs in it; hand those realms to `patchChild` on first access.

import { redefineGetter, type Realm } from "./realm";

export function patchChildRealms(win: Realm, patchChild: (child: Realm) => Realm): void {
  for (const C of [win.HTMLIFrameElement, win.HTMLFrameElement, win.HTMLObjectElement]) {
    if (!C) continue;
    redefineGetter(C.prototype, "contentWindow", (get) => function (this: unknown) { return patchChild(get.call(this)); });
    redefineGetter(C.prototype, "contentDocument", (get) => function (this: unknown) {
      const docu = get.call(this);
      if (docu && docu.defaultView) patchChild(docu.defaultView);
      return docu;
    });
  }
  const origOpen = win.open;
  if (origOpen) {
    win.open = function (...args: unknown[]) { return patchChild(origOpen.apply(this, args)); };
  }
}
