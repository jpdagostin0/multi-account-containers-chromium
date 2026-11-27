/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// History by container (Chromium port).
(async () => {
  "use strict";
  const page = chrome.extension.getBackgroundPage();
  const hist = page.__maccHistory;
  const top = page.__maccTopSites;
  const me = await browser.tabs.getCurrent();

  const idents = await browser.contextualIdentities.query({});
  const containers = [{ n: 0, csid: "firefox-default", name: "No container", color: null, icon: null }]
    .concat(idents.map((i) => ({
      n: Number(i.cookieStoreId.replace("firefox-container-", "")),
      csid: i.cookieStoreId, name: i.name, color: i.colorCode, icon: i.iconUrl,
    })));
  const byN = new Map(containers.map((c) => [c.n, c]));

  const params = new URLSearchParams(location.search);
  let filter = params.has("container") ? Number(params.get("container")) : null;
  if (filter !== null && !byN.has(filter)) filter = null;
  let text = "";
  let cursor = Infinity;
  let lastDay = null;
  const PAGE = 150;

  // ---- container filter ------------------------------------------------------
  const nav = document.getElementById("filters");
  const navItem = (n, name, c) => {
    const b = document.createElement("button");
    b.dataset.n = n === null ? "all" : String(n);
    const icon = document.createElement("span");
    icon.className = "ident-icon";
    if (c && c.color) b.style.setProperty("--c", c.color);
    if (c && c.icon) icon.style.setProperty("--icon", `url("${c.icon}")`);
    if (n === null) icon.style.visibility = "hidden";
    b.append(icon, name);
    b.addEventListener("click", () => {
      filter = n;
      const u = new URL(location.href);
      if (n === null) u.searchParams.delete("container"); else u.searchParams.set("container", n);
      window.history.replaceState(null, "", u);
      reset();
    });
    nav.append(b);
  };
  navItem(null, "All containers", null);
  containers.forEach((c) => navItem(c.n, c.name, c));

  // ---- list --------------------------------------------------------------------
  const list = document.getElementById("list");
  const more = document.getElementById("more");
  const empty = document.getElementById("empty");
  const clearBtn = document.getElementById("clear");
  const tpl = document.getElementById("row-tpl");
  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

  function dayLabel(t) {
    const d = new Date(t);
    const today = new Date();
    const yesterday = new Date(Date.now() - 864e5);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return dayFmt.format(d);
  }
  const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

  function renderRow(v) {
    const label = dayLabel(v.time);
    if (label !== lastDay) {
      const h = document.createElement("h2");
      h.className = "day";
      h.textContent = label;
      list.append(h);
      lastDay = label;
    }
    const c = byN.get(v.n) || byN.get(0);
    const row = tpl.content.firstElementChild.cloneNode(true);
    if (c.color) row.style.setProperty("--c", c.color);
    row.querySelector("time").textContent = timeFmt.format(new Date(v.time));
    row.querySelector("time").dateTime = new Date(v.time).toISOString();
    const fav = row.querySelector(".favicon");
    if (v.icon) fav.style.backgroundImage = `url("${v.icon}")`;
    else {
      fav.classList.add("letter");
      fav.textContent = (host(v.url).match(/[a-z0-9]/i) || ["•"])[0].toUpperCase();
    }
    const a = row.querySelector(".text");
    a.href = v.url;
    a.title = v.url;
    row.querySelector(".title").textContent = v.title || host(v.url);
    row.querySelector(".host").textContent = v.url.replace(/^https?:\/\//, "");
    row.querySelector(".badge").textContent = c.name;
    // Open in the container the visit happened in.
    a.addEventListener("click", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) browser.tabs.create({ url: v.url, cookieStoreId: c.csid, active: false });
      else top.openInTab(me.id, c.csid, v.url);
    });
    a.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      browser.tabs.create({ url: v.url, cookieStoreId: c.csid, active: false });
    });
    row.querySelector(".del").addEventListener("click", async () => {
      await hist.remove([v.id]);
      row.remove();
    });
    list.append(row);
  }

  let loading = false;
  async function load() {
    if (loading) return;
    loading = true;
    const rows = await hist.query({ n: filter, text, before: cursor, limit: PAGE });
    rows.forEach(renderRow);
    if (rows.length) cursor = rows[rows.length - 1].time;
    more.hidden = rows.length < PAGE;
    empty.hidden = list.childElementCount > 0;
    loading = false;
  }

  function reset() {
    list.replaceChildren();
    cursor = Infinity;
    lastDay = null;
    for (const b of nav.children) b.setAttribute("aria-current", String(b.dataset.n === (filter === null ? "all" : String(filter))));
    clearBtn.textContent = filter === null ? "Clear all history" : `Clear ${byN.get(filter).name} history`;
    load();
  }

  more.addEventListener("click", load);
  let t = null;
  document.getElementById("q").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => { text = e.target.value; reset(); }, 200);
  });
  clearBtn.addEventListener("click", async () => {
    const what = filter === null ? "all containers" : byN.get(filter).name;
    if (!confirm(`Delete the extension's history for ${what}? Chromium's own history is not affected.`)) return;
    await hist.clear(filter);
    reset();
  });
  reset();
})();
