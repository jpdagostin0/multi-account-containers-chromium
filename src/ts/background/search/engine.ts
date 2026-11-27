/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The browser's default search engine, from the native helper (it reads the
// profile's preferences; chrome.search doesn't say which engine it uses).

import { askHelper } from "../native";

export interface Engine { name: string; keyword: string; url: string; suggestionsUrl: string; faviconUrl?: string }

const TTL = 60_000;
/** A miss is retried sooner: a new install isn't in the browser's preferences yet. */
const MISS_TTL = 5_000;
let cached: { engine: Engine | null; at: number } | null = null;
let pending: Promise<Engine | null> | null = null;

/** The default engine, or null without the helper or a chosen engine. */
export function engine(): Promise<Engine | null> {
  if (cached && Date.now() - cached.at < (cached.engine ? TTL : MISS_TTL)) return Promise.resolve(cached.engine);
  pending ??= askHelper<{ engine?: Engine | null }>({ type: "search" }, 3000).then((r) => {
    cached = { engine: r?.engine ?? null, at: Date.now() };
    pending = null;
    return cached.engine;
  });
  return pending;
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
