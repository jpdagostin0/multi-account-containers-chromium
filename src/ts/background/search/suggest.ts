/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Search suggestions for the new tab page: the default engine's suggestions
// (OpenSearch JSON: ["query", ["suggestion", ...], ...]) and open tabs that
// match. History matches come from the history module.

import { csidOf } from "../../lib/constants";
import { base } from "../base";
import { iso } from "../isolation";
import { engine, fillTemplate } from "./engine";

const MAX_SUGGESTIONS = 6;
const MAX_TABS = 3;

/** The engine's suggestions for text. Sent without cookies. */
export async function suggest(text: string): Promise<string[]> {
  const e = await engine();
  if (!e?.suggestionsUrl || !text.trim()) return [];
  try {
    const res = await fetch(fillTemplate(e.suggestionsUrl, text), { credentials: "omit", signal: AbortSignal.timeout(2000) });
    const body: unknown = await res.json();
    if (!Array.isArray(body) || !Array.isArray(body[1])) return [];
    return (body[1] as unknown[]).filter((s): s is string => typeof s === "string" && s !== text).slice(0, MAX_SUGGESTIONS);
  } catch {
    return [];
  }
}

export interface TabMatch { id: number; windowId: number; title: string; url: string; favIconUrl: string | null; cookieStoreId: string }

/** Open tabs whose title or URL contains every word of text. */
export async function tabs(text: string, exceptTabId?: number): Promise<TabMatch[]> {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const all = await base.tabs.query({});
  return all
    .filter((t) => t.id !== exceptTabId && t.url && /^https?:/.test(t.url) && !t.incognito)
    .filter((t) => {
      const hay = `${t.title ?? ""} ${t.url}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
    .slice(0, MAX_TABS)
    .map((t) => ({
      id: t.id!, windowId: t.windowId!, title: t.title || t.url!, url: t.url!,
      favIconUrl: t.favIconUrl || null,
      cookieStoreId: csidOf(iso.containerOf(t.id!)),
    }));
}
