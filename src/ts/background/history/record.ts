/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Each committed top-level http(s) navigation (including in-page
// navigations of single-page apps) is stored with the tab's container.

import { done, req } from "../../lib/idb";
import { base } from "../base";
import { iso } from "../isolation";
import { store, type Visit } from "./db";

const SKIP_TRANSITIONS = new Set(["auto_subframe", "manual_subframe", "reload"]);
const DEDUPE_MS = 5000;
const lastVisit = new Map<number, { id: number; url: string; time: number }>();

async function addVisit(tabId: number, url: string, transition: string): Promise<void> {
  if (!/^https?:/.test(url)) return;
  const n = iso.containerOf(tabId);
  const now = Date.now();
  const prev = lastVisit.get(tabId);
  // Same page again within a few seconds (redirect hops, pushState echoes).
  if (prev && prev.url === url && now - prev.time < DEDUPE_MS) return;
  let title = "";
  try { title = (await base.tabs.get(tabId)).title || ""; } catch { /* tab gone */ }
  if (title === url || /^https?:\/\//.test(title)) title = "";
  const { tx, os } = await store("visits", "readwrite");
  const id = await req(os.add({ n, url, title, time: now, transition })) as number;
  await done(tx);
  lastVisit.set(tabId, { id, url, time: now });
}

/** Titles usually arrive after the commit. */
async function updateTitle(tabId: number, url: string | undefined, title: string): Promise<void> {
  const v = lastVisit.get(tabId);
  if (!v || v.url !== url || !title || title === url) return;
  const { tx, os } = await store("visits", "readwrite");
  const rec = await req(os.get(v.id)) as Visit | undefined;
  if (rec && rec.title !== title) {
    rec.title = title;
    os.put(rec);
  }
  await done(tx);
}

function incognito(tabId: number): Promise<boolean> {
  return new Promise((resolve) => chrome.tabs.get(tabId, (t) => {
    void chrome.runtime.lastError;
    resolve(!t || t.incognito);
  }));
}

chrome.webNavigation.onCommitted.addListener(async (d) => {
  if (d.frameId !== 0 || SKIP_TRANSITIONS.has(d.transitionType)) return;
  if (await incognito(d.tabId)) return;
  addVisit(d.tabId, d.url, d.transitionType).catch((e) => console.warn("macc history", e));
});
chrome.webNavigation.onHistoryStateUpdated.addListener(async (d) => {
  if (d.frameId !== 0 || await incognito(d.tabId)) return;
  addVisit(d.tabId, d.url, "in_page").catch((e) => console.warn("macc history", e));
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.title && tab && !tab.incognito) updateTitle(tabId, tab.url, info.title).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => { lastVisit.delete(tabId); });
