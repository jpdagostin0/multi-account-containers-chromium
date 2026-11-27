/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Per-container top sites for the new tab page (Chromium port, background).
//
// Chromium's history and topSites are shared by all containers, so visits are
// counted here per container: every committed top-level http(s) navigation
// bumps a frecency score (visits decayed by age) for its page in the tab's
// container. "No container" starts out seeded from chrome.topSites, minus
// sites we've seen in containers. Site icons come from history.js.
(() => {
  "use strict";

  const iso = globalThis.__maccIso;
  const { base, IDENT_KEY } = globalThis.__maccCompat;
  const KEY = "__macc_topsites";
  const HALF_LIFE_DAYS = 14;
  const PER_CONTAINER = 60;
  const SKIP_TRANSITIONS = new Set(["auto_subframe", "manual_subframe", "reload", "form_submit"]);

  let data = null;  // { "<n>": { "<url>": {title, score, last, hidden?} } }
  let saveTimer = null;

  const decay = (score, last, now) => score * Math.pow(0.5, (now - last) / (HALF_LIFE_DAYS * 864e5));

  function pageKey(url) {
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return null;
      // Top sites are pages people come back to: ignore query/hash noise.
      return `${u.origin}${u.pathname === "/" ? "/" : u.pathname.replace(/\/$/, "")}`;
    } catch {
      return null;
    }
  }

  let loading = null;
  function load() {
    if (!loading) {
      loading = (async () => {
        const all = await base.storage.local.get(KEY);
        data = all[KEY] || {};
        if (!all[KEY]) await seedDefault();
      })();
    }
    return loading;
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      prune();
      base.storage.local.set({ [KEY]: data });
    }, 1000);
  }

  function prune() {
    const now = Date.now();
    for (const n of Object.keys(data)) {
      const entries = Object.entries(data[n]);
      if (entries.length <= PER_CONTAINER) continue;
      entries.sort(([, a], [, b]) => decay(b.score, b.last, now) - decay(a.score, a.last, now));
      data[n] = Object.fromEntries(entries.slice(0, PER_CONTAINER));
    }
  }

  async function seedDefault() {
    if (!chrome.topSites) return;
    const top = await new Promise((r) => chrome.topSites.get((l) => { void chrome.runtime.lastError; r(l || []); }));
    const now = Date.now();
    const bucket = (data["0"] = data["0"] || {});
    top.forEach((s, i) => {
      const k = pageKey(s.url);
      if (k && !bucket[k]) bucket[k] = { title: s.title || "", score: Math.max(1, 10 - i * 0.5), last: now, seeded: true };
    });
    save();
  }

  function record(n, url, title) {
    const k = pageKey(url);
    if (!k) return;
    const now = Date.now();
    const bucket = (data[String(n)] = data[String(n)] || {});
    const e = bucket[k] || { title: "", score: 0, last: now };
    e.score = decay(e.score, e.last, now) + 1;
    e.last = now;
    if (title) e.title = title;
    delete e.seeded;
    bucket[k] = e;
    // A site used in a container no longer counts as a "no container" seed.
    if (n && data["0"] && data["0"][k] && data["0"][k].seeded) delete data["0"][k];
    save();
  }

  function setTitle(n, url, title) {
    const k = pageKey(url);
    const e = k && data[String(n)] && data[String(n)][k];
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
      load().then(() => record(iso.containerOf(d.tabId), d.url, ""));
    });
  });
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (!info.title || !tab || tab.incognito) return;
    load().then(() => setTitle(iso.containerOf(tabId), tab.url, info.title));
  });

  globalThis.__maccTopSites = {
    async list(limit = 12) {
      await load();
      const now = Date.now();
      const out = {};
      for (const [n, bucket] of Object.entries(data)) {
        if (n !== "0" && !iso.identityExists(Number(n))) continue;
        out[n] = Object.entries(bucket)
          .filter(([, e]) => !e.hidden)
          .map(([url, e]) => ({ url, title: e.title, score: decay(e.score, e.last, now) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
      }
      const origins = [...new Set(Object.values(out).flat().map((t) => new URL(t.url).origin))];
      const icons = await globalThis.__maccHistory.iconsFor(origins);
      Object.values(out).flat().forEach((t) => { t.icon = icons[new URL(t.url).origin] || null; });
      // Fetch icons for tiles that don't have one yet (e.g. seeded sites).
      for (const o of origins.filter((x) => !icons[x])) {
        globalThis.__maccHistory.saveIcon(o, `${o}/favicon.ico`).catch(() => {});
      }
      return out;
    },
    async hide(n, url) {
      await load();
      const e = data[String(n)] && data[String(n)][url];
      if (e) {
        e.hidden = true;
        save();
      }
    },
    async openInTab(tabId, csid, url) {
      // The new tab page holds no site data, so its tab can just switch
      // container before navigating.
      iso.setTab(tabId, csid);
      await base.tabs.update(tabId, { url });
    },
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[IDENT_KEY] || !data) return;
    const live = new Set((changes[IDENT_KEY].newValue || { list: [] }).list.map((r) => String(r.id)));
    for (const n of Object.keys(data)) if (n !== "0" && !live.has(n)) delete data[n];
    save();
  });
})();
