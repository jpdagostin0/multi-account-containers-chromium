/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// "Container highlighting" settings.

import type { HighlightApi } from "../../background/highlight";
import { el } from "./dom";

function toggle(highlight: HighlightApi, key: "tabGroups" | "pageBorder", title: string, description: string) {
  const input = el("input", { type: "checkbox", id: `macc-${key}` });
  input.addEventListener("change", () => highlight.setSettings({ [key]: input.checked }));
  const label = el("label", {}, input, el("span", { className: "bold", textContent: ` ${title}` }));
  return { input, node: el("div", { className: "settings-group" }, label, el("p", {}, el("em", { textContent: description }))) };
}

export function highlightingSection(highlight: HighlightApi) {
  const groups = toggle(highlight, "tabGroups", "Group container tabs",
    "Put each container's tabs in a tab group named and colored after the container (needs the tab group companion).");
  const border = toggle(highlight, "pageBorder", "Colored page border",
    "Draw a thin frame in the container's color around pages open in a container.");
  const note = el("p", { id: "macc-companion-status" });
  const node = el("div", { id: "macc-highlight", className: "settings-group" },
    el("h3", { textContent: "Container highlighting" }), border.node, groups.node, note);

  function render(): void {
    const h = highlight.status();
    groups.input.checked = h.tabGroups;
    border.input.checked = h.pageBorder;
    note.replaceChildren();
    if (h.tabGroups && !h.companion.available) {
      note.append(
        "Tab groups need the small “tab group colors” companion extension, because Chromium only lets "
        + "Manifest V3 extensions color tab groups. Load ",
        el("code", { textContent: "multi-account-containers-chromium-tabgroups-*.zip" }),
        " from the releases page (or ", el("code", { textContent: "dist/chromium-tabgroups" }), ") unpacked.");
    } else if (h.tabGroups) {
      note.textContent = `Tab group companion ${h.companion.version} is active.`;
    }
  }
  return { node, render };
}
