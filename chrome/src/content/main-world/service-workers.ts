/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Service worker registration is disabled in container pages and on origins
// that have been used in a container (see background/isolation/service-workers.ts).

import type { Ctx } from "./context";
import type { Realm } from "./realm";

export function patchServiceWorkers(win: Realm, ctx: Ctx): void {
  const SWC = win.ServiceWorkerContainer && win.ServiceWorkerContainer.prototype;
  if (!SWC || !(ctx.n || ctx.block)) return;
  SWC.register = function () {
    return Promise.reject(new win.DOMException(
      "Service workers are disabled for sites used in containers", "SecurityError"));
  };
}
