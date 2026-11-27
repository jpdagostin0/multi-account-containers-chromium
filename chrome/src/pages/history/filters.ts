/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The container filter buttons.

import { identIcon, type Container } from "../containers";

export function filterButtons(
  containers: Container[],
  current: () => number | null,
  onSelect: (n: number | null) => void,
): { refresh(): void } {
  const nav = document.getElementById("filters")!;
  const item = (n: number | null, name: string, c: Container | null) => {
    const b = document.createElement("button");
    b.dataset.n = n === null ? "all" : String(n);
    if (c?.color) b.style.setProperty("--c", c.color);
    b.append(identIcon(c), name);
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
