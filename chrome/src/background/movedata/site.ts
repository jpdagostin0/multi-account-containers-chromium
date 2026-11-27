/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getDomain } from "tldts";

/** Registrable domain of a web page's URL. */
export function siteOf(url: string | undefined): string | null {
  if (!url || !URL.canParse(url)) return null;
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) return null;
  return getDomain(u.hostname, { allowPrivateDomains: true }) || u.hostname;
}
