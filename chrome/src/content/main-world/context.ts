/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Which container this document belongs to.

import { maccPurge } from "../../purge";
import type { Realm } from "./realm";

export const KEY = Symbol.for("multi-account-containers.ctx");
export interface Ctx { n: number; block: boolean }

const MARKER = "MACC0~ctx";
// Captured before any patching.
const ssGet = Storage.prototype.getItem;
const ssSet = Storage.prototype.setItem;

/** Our Server-Timing entry: the response went through the extension. */
function fromServerTiming(win: Realm): Ctx | null {
  const nav = win.performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const timing = (nav && nav.serverTiming) || [];
  const e = timing.find((x) => x.name === "macc");
  if (!e) return null;
  const [n, flag] = String(e.description).split("|");
  const ctx = { n: Number(n) || 0, block: flag === "b" };
  const p = timing.find((x) => x.name === "maccpurge");
  if (p) {
    const list = String(p.description).split(".").map((s) => {
      const [id, pn] = s.split(":");
      return { id: id!, n: Number(pn) || 0 };
    });
    try { maccPurge(list); } catch { /* ignore */ }
  }
  try { ssSet.call(win.sessionStorage, MARKER, JSON.stringify(ctx)); } catch { /* blocked */ }
  return ctx;
}

export function detect(win: Realm): Ctx {
  try {
    const ctx = fromServerTiming(win);
    if (ctx) return ctx;
  } catch { /* fall through */ }
  // about:blank / srcdoc / javascript: documents inherit from their creator.
  for (const get of [() => win.parent, () => win.opener]) {
    try {
      const other = get();
      if (other && other !== win && other[KEY]) return other[KEY];
    } catch { /* cross-origin */ }
  }
  // Served without touching the network (service worker, cache): the tab
  // remembers its container for this origin.
  try {
    const m = ssGet.call(win.sessionStorage, MARKER);
    if (m) return JSON.parse(m);
  } catch { /* blocked */ }
  return { n: 0, block: false };
}
