/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The toolbar button shows the tab's container (initial + color).

import { colorCode, lastError } from "../../lib/constants";
import { containerOf, identity } from "./state";

export function setBadge(tabId: number): void {
  const n = containerOf(tabId);
  const rec = n ? identity(n) : undefined;
  if (!rec) {
    chrome.browserAction.setBadgeText({ tabId, text: "" }, lastError);
    chrome.browserAction.setTitle({ tabId, title: "Multi-Account Containers" }, lastError);
    return;
  }
  const text = (Array.from(rec.name.trim())[0] || "•").toUpperCase();
  chrome.browserAction.setBadgeText({ tabId, text }, lastError);
  chrome.browserAction.setBadgeBackgroundColor({ tabId, color: colorCode(rec.color) }, lastError);
  chrome.browserAction.setTitle({ tabId, title: `${rec.name} — Multi-Account Containers` }, lastError);
}
