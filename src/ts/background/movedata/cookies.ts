/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Every cookie of the site (registrable domain, all subdomains) is renamed
// from the source prefix to the target prefix in the shared jar.

import { ANY_PREFIX } from "../../lib/constants";
import { base } from "../base";
import { allCookies, cookieUrl } from "../isolation";

const prefixFor = (n: number) => (n ? `MACC${n}~` : "");
const contextOfName = (name: string) => {
  const m = ANY_PREFIX.exec(name);
  return m ? Number(m[1]) : 0;
};

async function moveCookie(c: chrome.cookies.Cookie, from: number, to: number): Promise<boolean> {
  const url = cookieUrl(c);
  const details: chrome.cookies.SetDetails = {
    url,
    name: prefixFor(to) + c.name.slice(prefixFor(from).length),
    value: c.value,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    storeId: c.storeId,
  };
  if (!c.hostOnly) details.domain = c.domain;
  if (!c.session && c.expirationDate) details.expirationDate = c.expirationDate;
  if (c.partitionKey) details.partitionKey = c.partitionKey;
  try {
    await base.cookies.set(details as never);
    const old: chrome.cookies.CookieDetails = { url, name: c.name, storeId: c.storeId };
    if (c.partitionKey) old.partitionKey = c.partitionKey;
    await base.cookies.remove(old as never);
    return true;
  } catch (e) {
    console.warn("macc: couldn't move cookie", c.name, c.domain, e);
    return false;
  }
}

/** Returns how many cookies moved. */
export async function moveCookies(site: string, from: number, to: number): Promise<number> {
  const mine = (await allCookies()).filter((c) => {
    const d = c.domain.replace(/^\./, "");
    return (d === site || d.endsWith(`.${site}`)) && contextOfName(c.name) === from
      && !(from === 0 && c.name.startsWith("MACC0~"));
  });
  // Independent cookies: move them concurrently.
  const moved = await Promise.all(mine.map((c) => moveCookie(c, from, to)));
  return moved.filter(Boolean).length;
}
