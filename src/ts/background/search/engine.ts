/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The new tab page's search engine, chosen in the settings page. Without one,
// searches go to the browser's default engine (chrome.search), which
// extensions can't read, so there are no suggestions then.

import { base } from "../base";

export interface Engine { name: string; url: string; suggestionsUrl: string }

export const ENGINE_KEY = "__macc_search_engine";

/** Common engines for the settings page (Chromium's own search and suggest URLs). */
export const PRESETS: Engine[] = [
  { name: "DuckDuckGo", url: "https://duckduckgo.com/?q={searchTerms}", suggestionsUrl: "https://duckduckgo.com/ac/?q={searchTerms}&type=list" },
  { name: "Google", url: "https://www.google.com/search?q={searchTerms}", suggestionsUrl: "https://www.google.com/complete/search?client=chrome&q={searchTerms}" },
  { name: "Brave Search", url: "https://search.brave.com/search?q={searchTerms}", suggestionsUrl: "https://search.brave.com/api/suggest?q={searchTerms}" },
  { name: "Startpage", url: "https://www.startpage.com/sp/search?q={searchTerms}", suggestionsUrl: "https://www.startpage.com/osuggestions?q={searchTerms}" },
  { name: "Kagi", url: "https://kagi.com/search?q={searchTerms}", suggestionsUrl: "https://kagisuggest.com/api/autosuggest?q={searchTerms}" },
  { name: "Bing", url: "https://www.bing.com/search?q={searchTerms}", suggestionsUrl: "https://www.bing.com/osjson.aspx?query={searchTerms}" },
  { name: "Ecosia", url: "https://www.ecosia.org/search?q={searchTerms}", suggestionsUrl: "https://ac.ecosia.org/?q={searchTerms}&type=list" },
  { name: "Qwant", url: "https://www.qwant.com/?q={searchTerms}", suggestionsUrl: "https://api.qwant.com/api/suggest/?q={searchTerms}" },
];

/** The chosen engine, or null for the browser's default. */
export async function engine(): Promise<Engine | null> {
  const { [ENGINE_KEY]: e } = await base.storage.local.get(ENGINE_KEY);
  return e && typeof (e as Engine).url === "string" ? (e as Engine) : null;
}

/** "%s" (the usual shorthand) or {searchTerms} marks where the query goes. */
export const normalizeTemplate = (url: string) => url.trim().replace(/%s/g, "{searchTerms}");

const validTemplate = (t: string) => t.includes("{searchTerms}") && URL.canParse(t.replace("{searchTerms}", "x"));

/** Choose an engine (null: the browser's default). */
export async function setEngine(e: { name: string; url: string; suggestionsUrl?: string } | null): Promise<void> {
  if (!e) return base.storage.local.remove(ENGINE_KEY);
  const url = normalizeTemplate(e.url);
  const suggestionsUrl = normalizeTemplate(e.suggestionsUrl ?? "");
  if (!validTemplate(url)) throw new Error("The search URL needs %s where the search terms go.");
  if (suggestionsUrl && !validTemplate(suggestionsUrl)) throw new Error("The suggestions URL needs %s where the search terms go.");
  const name = e.name.trim() || new URL(url.replace("{searchTerms}", "x")).hostname;
  await base.storage.local.set({ [ENGINE_KEY]: { name, url, suggestionsUrl } });
}

/** Fill Chromium's TemplateURL placeholders ({searchTerms}, {language}, ...). */
export function fillTemplate(template: string, terms: string): string {
  return template.replace(/\{([^{}]+)\}/g, (_, name: string) => {
    switch (name.replace(/\?$/, "")) {
      case "searchTerms": return encodeURIComponent(terms);
      case "language": return encodeURIComponent(navigator.language);
      case "inputEncoding":
      case "outputEncoding": return "UTF-8";
      default: return ""; // {google:...} and other optional parameters
    }
  });
}
