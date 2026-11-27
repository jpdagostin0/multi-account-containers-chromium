/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

export const parse = (url: string): URL | null => (URL.canParse(url) ? new URL(url) : null);

export const isHttp = (u: URL) => u.protocol === "http:" || u.protocol === "https:";

export function originOf(url: string): string | null {
  const u = parse(url);
  return u && isHttp(u) ? u.origin : null;
}

export const normalizeUrl = (url: string) => parse(url)?.href ?? url;
