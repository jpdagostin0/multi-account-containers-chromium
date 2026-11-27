/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The tab's sessionStorage remembers its container per origin (session
// restore, documents served by a service worker or the cache).

const MARKER = "MACC0~ctx";

export function readMarker(): number | null {
  try {
    const m = sessionStorage.getItem(MARKER);
    return m ? JSON.parse(m).n : null;
  } catch {
    return null; // storage blocked
  }
}

export function writeMarker(n: number): void {
  try {
    sessionStorage.setItem(MARKER, JSON.stringify({ n, block: true }));
  } catch { /* storage blocked */ }
}
