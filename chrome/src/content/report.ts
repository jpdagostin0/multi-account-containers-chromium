/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The top frame tells the background which container its document picked
// up; the background may answer with a border color, a corrected marker, or
// a reload (see background/isolation/page-context.ts).

import { setBorder } from "./border";
import { writeMarker } from "./marker";

interface Reply { border?: string | null; marker?: number; reload?: boolean }

function headerContainer(): number | null {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const e = nav?.serverTiming?.find((x) => x.name === "macc");
    if (e) return Number(String(e.description).split("|")[0]) || 0;
  } catch { /* ignore */ }
  return null;
}

export function reportContext(marker: number | null): void {
  const header = headerContainer();
  const n = header !== null ? header : (marker || 0);
  try {
    chrome.runtime.sendMessage({ __macc: "ctx", n, header: header !== null, marker }, (res?: Reply) => {
      void chrome.runtime.lastError;
      if (!res) return;
      if (res.border !== undefined) setBorder(res.border);
      if (res.marker !== undefined) writeMarker(res.marker);
      if (res.reload) location.reload();
    });
  } catch { /* extension reloaded */ }
}
