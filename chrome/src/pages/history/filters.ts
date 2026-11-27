/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The container filter buttons.

import type { Container } from "../containers";

export function filterButtons(
  containers: Container[],
  current: () => number | null,
  onSelect: (n: number | null) => void,
): { refresh(): void } {
  const nav = document.getElementById("filters")!;
  const item = (n: number | null, name: string, c: Container | null) => {
    const b = document.createElement("button");
    b.dataset.n = n === null ? "all" : String(n);
    const icon = document.createElement("span");
    icon.className = "ident-icon";
    if (c?.color) b.style.setProperty("--c", c.color);
    if (c?.icon) icon.style.setProperty("--icon", `url("${c.icon}")`);
    if (n === null) icon.style.setProperty("--icon", 'url("/img/multiaccountcontainer-16.svg")');
    b.append(icon, name);
    b.addEventListener("click", () => onSelect(n));
    nav.append(b);
  };
  item(null, "All containers", null);
  containers.forEach((c) => item(c.n, c.name, c));
  return {
    refresh() {
      const want = current() === null ? "all" : String(current());
      for (const b of nav.children) b.setAttribute("aria-current", String((b as HTMLElement).dataset.n === want));
    },
  };
}
