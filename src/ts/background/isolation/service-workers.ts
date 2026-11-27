/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Service workers are per origin, not per container, and their fetches have
// no tab. The first container to use an origin owns its workers (their
// traffic is attributed to it); once a second container uses the origin the
// workers are removed and registration is disabled there.

import { lastError } from "../../lib/constants";

export const SW_KEY = "__macc_sw_owner";
const SHARED = -1;

/** origin -> container that owns its service workers (SHARED = nobody) */
let owners: Record<string, number> = {};
export const loadSwOwners = (saved: Record<string, number> | undefined) => { owners = saved || {}; };
export const swOwnerOf = (origin: string): number | undefined => owners[origin];

let timer: ReturnType<typeof setTimeout> | undefined;
function save(): void {
  clearTimeout(timer);
  timer = setTimeout(() => chrome.storage.local.set({ [SW_KEY]: owners }), 300);
}

function removeServiceWorkers(origin: string): Promise<void> {
  return new Promise((resolve) => {
    if (!chrome.browsingData) return resolve();
    chrome.browsingData.removeServiceWorkers({ origins: [origin] }, () => { lastError(); resolve(); });
  });
}

function share(origin: string): Promise<void> {
  owners[origin] = SHARED;
  save();
  return removeServiceWorkers(origin);
}

/** Container n loaded a document from origin. */
export function claimOrigin(origin: string, n: number): Promise<void> {
  const owner = owners[origin];
  if (owner === undefined) {
    owners[origin] = n;
    save();
  } else if (owner !== n && owner !== SHARED) {
    return share(origin);
  }
  return Promise.resolve();
}

/** A page of container n was served by a worker it doesn't own. */
export function disown(origin: string, n: number): Promise<void> {
  const owner = owners[origin];
  return owner !== undefined && owner !== n ? share(origin) : Promise.resolve();
}

export const swBlocked = (origin: string | null, n: number) =>
  !!origin && owners[origin] !== undefined && owners[origin] !== n;
