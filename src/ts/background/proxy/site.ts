/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getDomain } from "tldts";

/** Chromium pools connections per scheme + registrable domain. */
export function siteOf(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const u = new URL(url);
  if (!/^(https?|wss?):$/.test(u.protocol)) return null;
  const domain = getDomain(u.hostname, { allowPrivateDomains: true }) || u.hostname;
  const scheme = u.protocol === "https:" || u.protocol === "wss:" ? "https" : "http";
  return `${scheme}://${domain}`;
}
