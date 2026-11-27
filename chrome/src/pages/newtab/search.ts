/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The search box: stays in this tab, so in this tab's container.

import type { TopSitesApi } from "../../background/topsites";
import type { Container } from "../containers";

const looksLikeUrl = (text: string) =>
  /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(text) || /^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(text);

export function setUpSearch(tabId: number, mine: Container | undefined, top: TopSitesApi): void {
  const q = document.getElementById("q") as HTMLInputElement;
  if (mine && mine.n) q.placeholder = `Search the web in ${mine.name}`;
  document.getElementById("search")!.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = q.value.trim();
    if (!text) return;
    if (looksLikeUrl(text)) {
      top.openInTab(tabId, mine?.csid ?? "firefox-default", /:\/\//.test(text) ? text : `https://${text}`);
    } else if (chrome.search) {
      chrome.search.query({ text, disposition: "CURRENT_TAB" });
    }
  });
  q.focus();
}
