/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Cookie / Set-Cookie header rewriting.

import { ANY_PREFIX, prefixFor } from "../../lib/constants";

/**
 * Rewrites a request Cookie header for container n, in one pass:
 * value = what n may see, unprefixed; foreign = some other context has
 * cookies here. Most requests carry no container cookie at all, so the
 * default context takes a fast path that doesn't split the header.
 */
export function filterCookieHeader(raw: string, n: number): { value: string; foreign: boolean } {
  if (!n && !raw.includes("MACC")) return { value: raw, foreign: false };
  const pre = n ? prefixFor(n) : null;
  const out: string[] = [];
  let foreign = false;
  for (const part of raw.split(/;\s*/)) {
    if (!part) continue;
    const m = ANY_PREFIX.exec(part);
    if ((m ? Number(m[1]) : 0) !== n) {
      foreign = true;
    } else if (pre) {
      const rest = part.slice(pre.length);
      out.push(rest[0] === "=" ? rest.slice(1) : rest);
    } else if (!m) {
      out.push(part);
    }
  }
  return { value: out.join("; "), foreign };
}

/** Prefixes every cookie a response sets with container n's prefix. */
export function prefixSetCookie(value: string, n: number): string {
  const pre = prefixFor(n);
  return value.split("\n").map((line) => {
    const semi = line.indexOf(";");
    const first = (semi < 0 ? line : line.slice(0, semi)).trimStart();
    const rest = semi < 0 ? "" : line.slice(semi);
    if (ANY_PREFIX.test(first)) return line;
    return pre + (first.includes("=") ? first : `=${first}`) + rest;
  }).join("\n");
}
