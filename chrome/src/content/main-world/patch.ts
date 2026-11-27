/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Applies every storage patch to one realm, once.

import { patchBroadcastChannel } from "./broadcast-channel";
import { patchCacheStorage } from "./cache-storage";
import { patchChildRealms } from "./child-realms";
import { KEY, type Ctx } from "./context";
import { patchCookieStore } from "./cookie-store";
import { patchDocumentCookie } from "./document-cookie";
import { patchIndexedDB } from "./indexed-db";
import { namesFor } from "./names";
import type { Realm } from "./realm";
import { patchServiceWorkers } from "./service-workers";
import { patchWebStorage } from "./web-storage";

const patched = (win: Realm) => Object.prototype.hasOwnProperty.call(win, KEY);

export function patch(win: Realm, ctx: Ctx): void {
  if (patched(win)) return;
  Object.defineProperty(win, KEY, { value: ctx });
  const names = namesFor(ctx.n);
  patchDocumentCookie(win, names);
  patchCookieStore(win, names);
  patchWebStorage(win, names);
  patchIndexedDB(win, names);
  patchCacheStorage(win, names);
  patchBroadcastChannel(win, names);
  patchServiceWorkers(win, ctx);
  patchChildRealms(win, (child) => {
    try {
      if (child && child !== win && !patched(child)) patch(child, ctx);
    } catch { /* cross-origin */ }
    return child;
  });
}
