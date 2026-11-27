/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Cookie jar access shared by cookie removal and "move site data".

import { ANY_PREFIX, idOf, prefixFor } from "../../lib/constants";
import { base } from "../base";

type GetAll = (details: chrome.cookies.GetAllDetails) => Promise<chrome.cookies.Cookie[]>;

/** Every cookie in every store, partitioned (CHIPS) ones included. */
export async function allCookies(): Promise<chrome.cookies.Cookie[]> {
  const getAll = base.cookies.getAll as unknown as GetAll;
  const stores = await base.cookies.getAllCookieStores();
  const lists = await Promise.all(stores.map((s) => Promise.all([
    getAll({ storeId: s.id }),
    // An empty partitionKey matches every partition (Chromium 119+).
    getAll({ storeId: s.id, partitionKey: {} }).catch(() => []),
  ])));
  const seen = new Set<string>();
  return lists.flat(2).filter((c) => {
    const k = `${c.storeId}|${c.domain}|${c.path}|${c.name}|${JSON.stringify(c.partitionKey ?? null)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const cookieUrl = (c: chrome.cookies.Cookie) =>
  `http${c.secure ? "s" : ""}://${c.domain.replace(/^\./, "")}${c.path}`;

function hostMatches(domain: string, hostnames?: string[]): boolean {
  if (!hostnames || !hostnames.length) return true;
  const d = domain.replace(/^\./, "");
  return hostnames.some((h) => d === h || h.endsWith(`.${d}`) || d.endsWith(`.${h}`));
}

/** Remove one container's cookies (optionally only for some hostnames). */
export async function purgeCookies(csid: string, hostnames?: string[]): Promise<void> {
  const n = idOf(csid);
  const pre = n ? prefixFor(n) : null;
  const doomed = (await allCookies()).filter((c) =>
    (pre ? c.name.startsWith(pre) : !ANY_PREFIX.test(c.name)) && hostMatches(c.domain, hostnames));
  await Promise.all(doomed.map((c) => {
    const details: chrome.cookies.CookieDetails = { url: cookieUrl(c), name: c.name, storeId: c.storeId };
    if (c.partitionKey) details.partitionKey = c.partitionKey;
    return base.cookies.remove(details as never).catch(() => {});
  }));
}
