/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Moves the current site's data from the tab's container (or from no
// container) into another one, then reopens the tab there. Entries that
// already exist in the target are overwritten by the source.

import { csidOf, idOf, lastError } from "../../lib/constants";
import { base } from "../base";
import { iso } from "../isolation";
import { moveCookies } from "./cookies";
import { movePageStorage } from "./page-storage";
import { siteOf } from "./site";

export async function moveSiteData(tabId: number, toCsid: string) {
  const tab = await base.tabs.get(tabId);
  const site = siteOf(tab.url);
  if (!site) throw new Error("Only web pages have site data to move");
  const from = iso.containerOf(tabId);
  const to = idOf(toCsid);
  if (from === to) return { site, from: csidOf(from), to: csidOf(to), cookies: 0 };
  if (!iso.identityExists(to)) throw new Error(`Unknown container ${toCsid}`);
  const storage = await movePageStorage(tabId, from, to);
  const cookies = await moveCookies(site, from, to);
  // Reopen the tab in the target container, now holding the data.
  iso.setTab(tabId, csidOf(to));
  await new Promise<void>((r) => chrome.tabs.reload(tabId, { bypassCache: true }, () => { lastError(); r(); }));
  return { site, from: csidOf(from), to: csidOf(to), cookies, ...storage };
}
