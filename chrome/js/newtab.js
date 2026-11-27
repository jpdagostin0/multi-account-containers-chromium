/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// New tab page: top sites per container (Chromium port).
(async () => {
  "use strict";
  const page = chrome.extension.getBackgroundPage();
  const top = page.__maccTopSites;
  const me = await browser.tabs.getCurrent();
  const mine = me ? me.cookieStoreId : "firefox-default";
  const myN = mine === "firefox-default" ? 0 : Number(mine.replace("firefox-container-", ""));

  const idents = await browser.contextualIdentities.query({});
  const sections = [{ n: 0, csid: "firefox-default", name: "No container", color: null, icon: null }]
    .concat(idents.map((i) => ({
      n: Number(i.cookieStoreId.replace("firefox-container-", "")),
      csid: i.cookieStoreId,
      name: i.name,
      color: i.colorCode,
      icon: i.iconUrl,
    })));
  // This tab's container first, then the rest in the panel's order.
  sections.sort((a, b) => (b.n === myN) - (a.n === myN));
  const mineSection = sections.find((s) => s.n === myN);
  if (mineSection && mineSection.color) document.documentElement.style.setProperty("--accent", mineSection.color);

  // ---- search: stays in this tab, so in this tab's container ------------
  const q = document.getElementById("q");
  if (mineSection && myN) q.placeholder = `Search the web in ${mineSection.name}`;
  document.getElementById("search").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = q.value.trim();
    if (!text) return;
    if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(text) || /^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(text)) {
      const url = /:\/\//.test(text) ? text : `https://${text}`;
      top.openInTab(me.id, mine, url);
    } else if (chrome.search) {
      chrome.search.query({ text, disposition: "CURRENT_TAB" });
    }
  });
  q.focus();
  if (myN) document.getElementById("history-link").href = `history.html?container=${myN}`;

  // ---- sections ------------------------------------------------------------
  const lists = await top.list(16);
  const root = document.getElementById("sections");
  const sectionTpl = document.getElementById("section-tpl");
  const tileTpl = document.getElementById("tile-tpl");

  const label = (url, title) => {
    if (title) return title;
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
  };

  for (const s of sections) {
    const tiles = lists[String(s.n)] || [];
    if (!tiles.length && s.n !== myN) continue;
    const node = sectionTpl.content.firstElementChild.cloneNode(true);
    if (s.color) node.style.setProperty("--c", s.color);
    if (s.n === myN) node.classList.add("current");
    node.dataset.container = s.csid;
    const icon = node.querySelector(".ident-icon");
    if (s.icon) icon.style.setProperty("--icon", `url("${s.icon}")`);
    node.querySelector(".name").textContent = s.name;
    node.querySelector(".empty").textContent = s.n
      ? `Sites you visit in ${s.name} will show up here.`
      : "Sites you visit without a container will show up here.";
    const ol = node.querySelector(".tiles");
    for (const t of tiles) {
      const li = tileTpl.content.firstElementChild.cloneNode(true);
      const a = li.querySelector("a");
      a.href = t.url;
      a.title = `${label(t.url, t.title)}\n${t.url}\n${s.name}`;
      const fav = li.querySelector(".favicon");
      if (t.icon) {
        fav.style.backgroundImage = `url("${t.icon}")`;
      } else {
        fav.classList.add("letter");
        fav.textContent = (label(t.url, "").match(/[a-z0-9]/i) || ["•"])[0].toUpperCase();
      }
      li.querySelector(".title").textContent = label(t.url, t.title);
      li.querySelector(".host").textContent = label(t.url, "");
      a.addEventListener("click", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          browser.tabs.create({ url: t.url, cookieStoreId: s.csid, active: e.shiftKey, openerTabId: me.id });
        } else {
          top.openInTab(me.id, s.csid, t.url);
        }
      });
      a.addEventListener("auxclick", (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        browser.tabs.create({ url: t.url, cookieStoreId: s.csid, active: false });
      });
      li.querySelector(".hide").addEventListener("click", async () => {
        await top.hide(s.n, t.url);
        li.remove();
      });
      ol.append(li);
    }
    root.append(node);
  }
})();
