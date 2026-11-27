/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Which container a request belongs to.

import { swOwnerOf } from "./service-workers";
import { containerOf, identityExists, requestOverride } from "./state";

export type RequestInfo = { requestId: string; tabId: number; initiator?: string };

export function contextFor(d: RequestInfo): number {
  const o = requestOverride.get(d.requestId);
  if (o !== undefined) return o;
  if (d.tabId >= 0) return containerOf(d.tabId);
  // No tab: service worker / shared worker traffic. Attribute it to the
  // container that owns the worker's origin, if any.
  const owner = d.initiator ? swOwnerOf(d.initiator) : undefined;
  return owner !== undefined && owner > 0 && identityExists(owner) ? owner : 0;
}
