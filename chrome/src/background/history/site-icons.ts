/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Site icons, one per origin, only ever updated when the site is visited:
// the icon the page declares (favicon.ts reports it) is fetched without
// cookies and hashed, and the stored copy is replaced only if the hash
// changed. Used by the new tab and history pages.

import { done, req } from "../../lib/idb";
import { base } from "../base";
import { fetchIcon, plainIcon } from "../icons";
import { store, type IconRec } from "./db";

export async function iconsFor(origins: string[]): Promise<Record<string, string>> {
  if (!origins.length) return {};
  const { os } = await store("icons");
  const recs = await Promise.all(origins.map((o) => req(os.get(o)) as Promise<IconRec | undefined>));
  return Object.fromEntries(recs.filter((r): r is IconRec => !!r).map((r) => [r.origin, r.url]));
}

const toHex = (bytes: Uint8Array): string => {
  // Uint8Array.prototype.toHex: Chromium 140+.
  const native = (bytes as Uint8Array & { toHex?: () => string }).toHex;
  return native ? native.call(bytes) : Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};
const sha256 = async (blob: Blob) =>
  toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())));

const inflight = new Set<string>();

/** Re-encodes and stores the icon only if it changed. */
export async function saveIcon(origin: string, href: string): Promise<boolean> {
  if (inflight.has(origin)) return false;
  inflight.add(origin);
  try {
    const blob = await fetchIcon(href);
    if (!blob) return false;
    const hash = await sha256(blob);
    const { os } = await store("icons");
    const old = await req(os.get(origin)) as IconRec | undefined;
    if (old && old.hash === hash) return false;
    const url = await plainIcon(blob);
    if (!url) return false;
    const w = await store("icons", "readwrite");
    w.os.put({ origin, href, hash, url, updated: Date.now() } satisfies IconRec);
    await done(w.tx);
    return true;
  } finally {
    inflight.delete(origin);
  }
}

chrome.runtime.onMessage.addListener((msg: { __macc?: string; href?: string } | undefined, sender) => {
  if (!msg || msg.__macc !== "favicon" || !sender.tab || !msg.href) return;
  if (sender.tab.incognito || !sender.tab.url || !URL.canParse(sender.tab.url)) return;
  saveIcon(new URL(sender.tab.url).origin, msg.href).catch(() => {});
});

/** Icons saved by older versions in storage.local move into the database. */
export async function migrateLegacyIcons(): Promise<void> {
  const { __macc_site_icons: old } = await base.storage.local.get("__macc_site_icons");
  if (!old) return;
  const { tx, os } = await store("icons", "readwrite");
  for (const [origin, url] of Object.entries(old as Record<string, string>)) {
    os.put({ origin, href: "", url, updated: 0 } satisfies IconRec);
  }
  await done(tx);
  await base.storage.local.remove("__macc_site_icons");
}
