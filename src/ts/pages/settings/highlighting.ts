/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Container highlighting: page border and tab groups (both opt-in).

import type { HighlightApi } from "../../background/highlight";
import { card, el, toggle } from "./dom";

export function highlightingSection(highlight: HighlightApi): HTMLElement {
  const border = toggle("Colored page border", "A thin frame in the container's color around pages open in a container.",
    (on) => highlight.setSettings({ pageBorder: on }));
  const groups = toggle("Group container tabs", "Put each container's tabs in a tab group named and colored after it. Needs the tab group companion extension.",
    (on) => highlight.setSettings({ tabGroups: on }));
  const note = el("p", { className: "setting-desc" });

  function render(): void {
    const h = highlight.status();
    border.input.checked = h.pageBorder;
    groups.input.checked = h.tabGroups;
    note.textContent = !h.tabGroups ? ""
      : h.companion.available ? `Tab group companion ${h.companion.version} is active.`
        : "Tab groups need the “tab group colors” companion: load dist/chromium-tabgroups (or the release zip) unpacked.";
  }
  render();
  setInterval(render, 2000);

  return card("Container highlighting", "The toolbar button always shows the current tab's container.", border.node, groups.node, note);
}
