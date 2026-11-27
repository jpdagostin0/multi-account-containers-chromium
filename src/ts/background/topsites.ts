/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Per-container top sites for the new tab page (Chromium port, background).
//
// Chromium's history and topSites are shared by all containers, so visits are
// counted here per container: every committed top-level http(s) navigation
// bumps a frecency score (visits decayed by age) for its site (origin) in the
// tab's container. "No container" starts out seeded from chrome.topSites,
// minus sites we've seen in containers. Site icons come from history.

import { IDENT_KEY, whenIdle, type IdentityState } from "../lib/constants";
import { base } from "./base";
import { history } from "./history";
import { iso } from "./isolation";

const KEY = "__macc_topsites";
const HALF_LIFE_DAYS = 14;
const PER_CONTAINER = 60;
const SKIP_TRANSITIONS = new Set(["auto_subframe", "manual_subframe", "reload", "form_submit"]);

interface Entry { title: string; score: number; last: number; hidden?: boolean; seeded?: boolean }
/** container number -> site ("https://host/") -> entry */
type Data = Record<string, Record<string, Entry>>;
export interface TopSite { url: string; title: string; score: number; icon?: string | null }

let data: Data = {};
let saveTimer: ReturnType<typeof setTimeout> | undefined;

const decay = (score: number, last: number, now: number) =>
  score * Math.pow(0.5, (now - last) / (HALF_LIFE_DAYS * 864e5));

/** Visits count for the site, not the page: its origin's front page. */
function siteKey(url: string | undefined): string | null {
  if (!url || !URL.canParse(url)) return null;
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) return null;
  return `${u.origin}/`;
}

/** Only a site's front page names the site; other pages' titles name pages. */
const isFrontPage = (url: string | undefined) => !!url && URL.canParse(url) && new URL(url).pathname === "/";

/** Older versions kept one entry per page: fold them into their sites. */
function mergeIntoSites(old: Data): Data {
  const now = Date.now();
  const out: Data = {};
  for (const [n, entries] of Object.entries(old)) {
    const b: Record<string, Entry> = (out[n] = {});
    for (const [url, e] of Object.entries(entries)) {
      const k = siteKey(url);
      if (!k) continue;
      const merged = b[k];
      if (!merged) {
        b[k] = { ...e, score: decay(e.score, e.last, now), last: now, title: url === k ? e.title : "", hidden: url === k ? e.hidden : undefined };
        continue;
      }
      merged.score += decay(e.score, e.last, now);
      if (url === k) merged.title = e.title;
      if (url === k && e.hidden) merged.hidden = true;
      if (!e.seeded) delete merged.seeded;
    }
  }
  return out;
}

let loading: Promise<void> | null = null;
function load(): Promise<void> {
  loading ??= (async () => {
    const all = await base.storage.local.get(KEY);
    const stored = (all[KEY] as Data | undefined) ?? {};
    const perPage = Object.values(stored).some((b) => Object.keys(b).some((url) => url !== siteKey(url)));
    data = perPage ? mergeIntoSites(stored) : stored;
    if (perPage) save();
    if (!all[KEY]) await seedDefault();
  })();
  return loading;
}

function prune(): void {
  const now = Date.now();
  for (const n of Object.keys(data)) {
    const entries = Object.entries(data[n]!);
    if (entries.length <= PER_CONTAINER) continue;
    entries.sort(([, a], [, b]) => decay(b.score, b.last, now) - decay(a.score, a.last, now));
    data[n] = Object.fromEntries(entries.slice(0, PER_CONTAINER));
  }
}

function save(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => whenIdle(() => {
    prune();
    base.storage.local.set({ [KEY]: data });
  }), 1000);
}

const bucket = (n: number | string) => (data[String(n)] ??= {});

async function seedDefault(): Promise<void> {
  if (!chrome.topSites) return;
  const top = await new Promise<chrome.topSites.MostVisitedURL[]>((r) =>
    chrome.topSites.get((l) => { void chrome.runtime.lastError; r(l || []); }));
  const now = Date.now();
  const b = bucket(0);
  top.forEach((s, i) => {
    const k = siteKey(s.url);
    if (k && !b[k]) b[k] = { title: isFrontPage(s.url) ? s.title || "" : "", score: Math.max(1, 10 - i * 0.5), last: now, seeded: true };
  });
  save();
}

function record(n: number, url: string): void {
  const k = siteKey(url);
  if (!k) return;
  const now = Date.now();
  const b = bucket(n);
  const e = b[k] ?? { title: "", score: 0, last: now };
  e.score = decay(e.score, e.last, now) + 1;
  e.last = now;
  delete e.seeded;
  b[k] = e;
  // A site used in a container no longer counts as a "no container" seed.
  if (n && data["0"]?.[k]?.seeded) delete data["0"][k];
  save();
}

function setTitle(n: number, url: string | undefined, title: string): void {
  if (!isFrontPage(url)) return;
  const k = siteKey(url);
  const e = k ? data[String(n)]?.[k] : undefined;
  if (e && title && e.title !== title) {
    e.title = title;
    save();
  }
}

chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId !== 0 || SKIP_TRANSITIONS.has(d.transitionType)) return;
  if ((d.transitionQualifiers || []).includes("client_redirect")) return;
  chrome.tabs.get(d.tabId, (tab) => {
    void chrome.runtime.lastError;
    if (!tab || tab.incognito) return;
    load().then(() => record(iso.containerOf(d.tabId), d.url));
  });
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!info.title || !tab || tab.incognito) return;
  load().then(() => setTitle(iso.containerOf(tabId), tab.url, info.title!));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[IDENT_KEY] || !loading) return;
  const live = new Set(((changes[IDENT_KEY].newValue as IdentityState | undefined)?.list ?? []).map((r) => String(r.id)));
  for (const n of Object.keys(data)) if (n !== "0" && !live.has(n)) delete data[n];
  save();
});

export const topSites = {
  async list(limit = 12): Promise<Record<string, TopSite[]>> {
    await load();
    const now = Date.now();
    const out: Record<string, TopSite[]> = {};
    for (const [n, b] of Object.entries(data)) {
      if (n !== "0" && !iso.identityExists(Number(n))) continue;
      out[n] = Object.entries(b)
        .filter(([, e]) => !e.hidden)
        .map(([url, e]) => ({ url, title: e.title, score: decay(e.score, e.last, now) }))
        .sort((a, b2) => b2.score - a.score)
        .slice(0, limit);
    }
    const all = Object.values(out).flat();
    const icons = await history.iconsFor([...new Set(all.map((t) => new URL(t.url).origin))]);
    for (const t of all) t.icon = icons[new URL(t.url).origin] || null;
    return out;
  },
  async hide(n: number, url: string): Promise<void> {
    await load();
    const e = data[String(n)]?.[url];
    if (e) {
      e.hidden = true;
      save();
    }
  },
  /** The new tab page holds no site data, so its tab can just switch container before navigating. */
  async openInTab(tabId: number, csid: string, url: string): Promise<void> {
    iso.setTab(tabId, csid);
    await base.tabs.update(tabId, { url });
  },
  /** Move a tab (this new tab page) into another container. */
  switchTab(tabId: number, csid: string): void {
    iso.setTab(tabId, csid);
  },
};
export type TopSitesApi = typeof topSites;
