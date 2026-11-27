/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Page-side storage wipes: localStorage/sessionStorage/IndexedDB/Cache
// Storage of one container (optionally only for some hostnames). Pages apply
// them at document_start of their next load (they get the list via
// Server-Timing and record what they applied in their own storage); open
// pages are wiped right away.

import { idOf, lastError } from "../../lib/constants";
import type { PurgeEntry } from "../../purge";
import purgeSource from "../../purge?script";
import { base } from "../base";
import { parse } from "./urls";

export const PURGE_KEY = "__macc_purges";
interface StoredPurge extends PurgeEntry { host: string | null }

let purges: StoredPurge[] = [];
export const loadPurges = (saved: StoredPurge[] | undefined) => { purges = saved || []; };

/** The wipes a document at url must apply. */
export function purgeListFor(url: string): StoredPurge[] {
  if (!purges.length) return purges;
  const host = parse(url)?.hostname ?? "";
  return purges.filter((p) => !p.host || p.host === host || host.endsWith(`.${p.host}`));
}

export async function purgeStorage(csid: string, hostnames?: string[]): Promise<void> {
  const n = idOf(csid);
  const hosts: (string | null)[] = hostnames && hostnames.length ? hostnames : [null];
  const added: StoredPurge[] = hosts.map((host) => ({
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, n, host,
  }));
  purges = [...purges, ...added];
  await base.storage.local.set({ [PURGE_KEY]: purges });
  const fresh = new Set(added);
  for (const t of await base.tabs.query({ url: ["http://*/*", "https://*/*"] })) {
    const list = purgeListFor(t.url || "").filter((p) => fresh.has(p));
    if (!list.length) continue;
    chrome.tabs.executeScript(t.id!, { allFrames: true, code: `(${purgeSource})(${JSON.stringify(list)})` }, lastError);
  }
}
