/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The new tab page's search engine: one the user set in the options page, or
// else the browser's default, from the native helper (it reads the profile's
// preferences; chrome.search doesn't say which engine it uses).

import { base } from "../base";
import { askHelper } from "../native";

export interface Engine { name: string; keyword?: string; url: string; suggestionsUrl: string; faviconUrl?: string; custom?: boolean }

export const CUSTOM_KEY = "__macc_search_engine";

const TTL = 60_000;
/** A miss is retried sooner: a new install isn't in the browser's preferences yet. */
const MISS_TTL = 5_000;
let cached: { engine: Engine | null; at: number } | null = null;
let pending: Promise<Engine | null> | null = null;

/** The browser's default engine, or null without the helper or a chosen engine. */
export function browserEngine(): Promise<Engine | null> {
  if (cached && Date.now() - cached.at < (cached.engine ? TTL : MISS_TTL)) return Promise.resolve(cached.engine);
  pending ??= askHelper<{ engine?: Engine | null }>({ type: "search" }, 3000).then((r) => {
    cached = { engine: r?.engine ?? null, at: Date.now() };
    pending = null;
    return cached.engine;
  });
  return pending;
}

export async function customEngine(): Promise<Engine | null> {
  const { [CUSTOM_KEY]: e } = await base.storage.local.get(CUSTOM_KEY);
  return e && typeof (e as Engine).url === "string" ? { ...(e as Engine), custom: true } : null;
}

/** The engine the new tab page searches and takes suggestions from. */
export async function engine(): Promise<Engine | null> {
  return (await customEngine()) ?? browserEngine();
}

/** "%s" (the usual shorthand) or {searchTerms} marks where the query goes. */
export const normalizeTemplate = (url: string) => url.trim().replace(/%s/g, "{searchTerms}");

/** Use a custom engine (null: back to the browser's default). */
export async function setCustomEngine(e: { name: string; url: string; suggestionsUrl?: string } | null): Promise<void> {
  if (!e) return base.storage.local.remove(CUSTOM_KEY);
  const url = normalizeTemplate(e.url);
  const suggestionsUrl = normalizeTemplate(e.suggestionsUrl ?? "");
  if (!URL.canParse(url.replace("{searchTerms}", "x")) || !url.includes("{searchTerms}")) {
    throw new Error("The search URL needs %s where the search terms go.");
  }
  if (suggestionsUrl && (!URL.canParse(suggestionsUrl.replace("{searchTerms}", "x")) || !suggestionsUrl.includes("{searchTerms}"))) {
    throw new Error("The suggestions URL needs %s where the search terms go.");
  }
  const name = e.name.trim() || new URL(url.replace("{searchTerms}", "x")).hostname;
  await base.storage.local.set({ [CUSTOM_KEY]: { name, url, suggestionsUrl } });
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
