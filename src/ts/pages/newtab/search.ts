/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The search box: stays in this tab, so in this tab's container.

import type { SearchApi } from "../../background/search";
import type { TopSitesApi } from "../../background/topsites";
import type { Container } from "../containers";

const looksLikeUrl = (text: string) =>
  /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(text) || /^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(text);

/** Open text as a URL, or search the default engine for it, in this tab. */
export type Go = (text: string) => void;

export function setUpSearch(tabId: number, mine: Container | undefined, top: TopSitesApi, search: SearchApi): Go {
  const q = document.getElementById("q") as HTMLInputElement;
  const where = mine && mine.n ? ` in ${mine.name}` : "";
  q.placeholder = `Search the web${where}`;
  search.engine().then((e) => { if (e?.name) q.placeholder = `Search ${e.name}${where}`; });

  const go: Go = (raw) => {
    const text = raw.trim();
    if (!text) return;
    if (looksLikeUrl(text)) {
      top.openInTab(tabId, mine?.csid ?? "firefox-default", /:\/\//.test(text) ? text : `https://${text}`);
    } else if (chrome.search) {
      chrome.search.query({ text, disposition: "CURRENT_TAB" });
    }
  };
  document.getElementById("search")!.addEventListener("submit", (e) => {
    e.preventDefault();
    go(q.value);
  });
  q.focus();
  return go;
}
