/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// One section of top sites per container.

import type { TopSite, TopSitesApi } from "../../background/topsites";
import { cloneTemplate, hostLabel, openInBackground, showFavicon, type Container } from "../containers";

const label = (t: TopSite) => t.title || hostLabel(t.url);

function tile(t: TopSite, s: Container, tabId: number, top: TopSitesApi): HTMLElement {
  const li = cloneTemplate("tile-tpl");
  const a = li.querySelector("a")!;
  a.href = t.url;
  a.title = `${label(t)}\n${t.url}\n${s.name}`;
  showFavicon(li.querySelector<HTMLElement>(".favicon")!, t.url, t.icon);
  li.querySelector(".title")!.textContent = label(t);
  li.querySelector(".host")!.textContent = hostLabel(t.url);
  a.addEventListener("click", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || e.shiftKey) openInBackground(t.url, s.csid, { active: e.shiftKey, openerTabId: tabId });
    else top.openInTab(tabId, s.csid, t.url);
  });
  a.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    openInBackground(t.url, s.csid);
  });
  li.querySelector(".hide")!.addEventListener("click", async () => {
    await top.hide(s.n, t.url);
    li.remove();
  });
  return li;
}

export function section(s: Container, tiles: TopSite[], current: boolean, tabId: number, top: TopSitesApi): HTMLElement {
  const node = cloneTemplate("section-tpl");
  if (s.color) node.style.setProperty("--c", s.color);
  if (current) node.classList.add("current");
  node.dataset.container = s.csid;
  if (s.icon) node.querySelector<HTMLElement>(".ident-icon")!.style.setProperty("--icon", `url("${s.icon}")`);
  node.querySelector(".name")!.textContent = s.name;
  node.querySelector(".empty")!.textContent = s.n
    ? `Sites you visit in ${s.name} will show up here.`
    : "Sites you visit without a container will show up here.";
  node.querySelector(".tiles")!.append(...tiles.map((t) => tile(t, s, tabId, top)));
  return node;
}
