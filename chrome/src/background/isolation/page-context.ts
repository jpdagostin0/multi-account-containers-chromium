/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The top frame reports which container its document picked up
// (content/report.ts):
//   n:      what the page is using now
//   header: whether that came from our Server-Timing entry
//   marker: what the tab's sessionStorage remembered before this load
// and gets back its border color, or is told to fix its marker and reload.

import { disown } from "./service-workers";
import { containerOf, hooks, identityExists, pendingCommit, recentReloads, startup, tabs } from "./state";
import { setTabN } from "./tabs";
import { originOf } from "./urls";

interface CtxMessage { __macc: "ctx"; n: number; header: boolean; marker: number | null }
interface Reply { border?: string | null; marker?: number; reload?: boolean }

const RESTORE_WINDOW = 120000;
const RELOAD_COOLDOWN = 15000;

/** Session restore: the restored page still knows its container. */
function restoredContainer(tabId: number, marker: number | null): number | null {
  if (tabs.has(tabId) || !startup.tabs.has(tabId) || Date.now() - startup.at >= RESTORE_WINDOW) return null;
  return marker && marker > 0 && identityExists(marker) ? marker : null;
}

function handle(msg: CtxMessage, tabId: number, origin: string | null, respond: (r: Reply) => void): boolean {
  const border = () => hooks.borderColorForTab(tabId);
  if (!origin || pendingCommit.has(tabId)) {
    respond({ border: border() });
    return false;
  }
  const restored = restoredContainer(tabId, msg.marker);
  if (restored !== null) {
    startup.tabs.delete(tabId);
    setTabN(tabId, restored);
    recentReloads.set(tabId, Date.now());
    respond({ reload: true });
    return false;
  }
  const expected = containerOf(tabId);
  if (msg.n === expected || Date.now() - (recentReloads.get(tabId) || 0) < RELOAD_COOLDOWN) {
    respond({ border: border() });
    return false;
  }
  recentReloads.set(tabId, Date.now());
  if (msg.header) {
    respond({ reload: true });
    return false;
  }
  // The document never reached the network (service worker or cache): take
  // the origin's workers away from whoever owns them, fix the tab's marker
  // and load it again.
  disown(origin, expected).then(() => respond({ marker: expected, reload: true }));
  return true;
}

chrome.runtime.onMessage.addListener((msg: CtxMessage | undefined, sender, respond) => {
  if (!msg || msg.__macc !== "ctx" || !sender.tab || sender.frameId !== 0) return undefined;
  return handle(msg, sender.tab.id!, originOf(sender.url || ""), respond) || undefined;
});
