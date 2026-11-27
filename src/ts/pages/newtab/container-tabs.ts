/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Container tabs at the top left: switch this new tab to another container.

import type { TopSitesApi } from "../../background/topsites";
import { identIcon, type Container } from "../containers";

export function setUpContainerTabs(containers: Container[], myN: number, tabId: number, top: TopSitesApi): void {
  const nav = document.getElementById("container-tabs")!;
  for (const c of containers) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.n = String(c.n);
    b.title = c.n === myN ? `This tab is in ${c.name}` : `Switch this tab to ${c.name}`;
    if (c.color) b.style.setProperty("--c", c.color);
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = c.name;
    b.append(identIcon(c), name);
    if (c.n === myN) b.setAttribute("aria-current", "true");
    b.addEventListener("click", () => {
      if (c.n === myN) return;
      top.switchTab(tabId, c.csid);
      document.documentElement.classList.add("switching");
      setTimeout(() => location.reload(), 120);
    });
    nav.append(b);
  }
  nav.querySelector('[aria-current="true"]')?.scrollIntoView({ inline: "nearest", block: "nearest" });
}
