/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/** proxy-status.html explaining why a navigation was stopped. */
export function statusPage(reason: string, url: string, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ reason, url, ...extra });
  return chrome.runtime.getURL(`proxy-status.html?${q}`);
}
