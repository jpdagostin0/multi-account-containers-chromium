/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Search engine of the new tab page: the browser's default, a common engine,
// or the user's own (search URL + suggestions URL).

import type { Engine, SearchApi } from "../../background/search";
import { card, el, field, savedNote } from "./dom";

const DEFAULT = "default";
const CUSTOM = "custom";
const shown = (t: string) => t.replace(/\{searchTerms\}/g, "%s");

export function searchSection(search: SearchApi): HTMLElement {
  const select = el("select", { id: "engine" });
  select.append(
    el("option", { value: DEFAULT, textContent: "Browser default (no suggestions)" }),
    ...search.presets.map((e, i) => el("option", { value: String(i), textContent: e.name })),
    el("option", { value: CUSTOM, textContent: "Custom…" }),
  );
  const name = field("Name", "My search");
  const url = field("Search URL", "https://example.com/search?q=%s");
  const suggestions = field("Suggestions URL (optional)", "https://example.com/suggest?q=%s");
  const save = el("button", { type: "button", className: "primary", textContent: "Save" });
  const note = savedNote();
  const custom = el("div", { className: "custom-engine" }, name.node, url.node, suggestions.node, el("div", { className: "actions" }, save, note.node));

  const fill = (e: Engine | null) => {
    name.input.value = e?.name ?? "";
    url.input.value = shown(e?.url ?? "");
    suggestions.input.value = shown(e?.suggestionsUrl ?? "");
  };
  const showCustom = () => { custom.hidden = select.value !== CUSTOM; };

  search.engine().then((e) => {
    const preset = e ? search.presets.findIndex((p) => p.url === e.url && p.suggestionsUrl === e.suggestionsUrl) : -1;
    select.value = !e ? DEFAULT : preset >= 0 ? String(preset) : CUSTOM;
    fill(e);
    showCustom();
  });

  select.addEventListener("change", async () => {
    showCustom();
    if (select.value === CUSTOM) return url.input.focus();
    const e = select.value === DEFAULT ? null : search.presets[Number(select.value)]!;
    await search.setEngine(e);
    fill(e);
    note.ok();
  });
  const saveCustom = async () => {
    try {
      await search.setEngine({ name: name.input.value, url: url.input.value, suggestionsUrl: suggestions.input.value });
      note.ok();
    } catch (err) {
      note.error((err as Error).message);
    }
  };
  save.addEventListener("click", saveCustom);
  for (const f of [name, url, suggestions]) f.input.addEventListener("keydown", (e) => { if (e.key === "Enter") saveCustom(); });

  return card("Search engine",
    "Used by the new tab page's search box, with its suggestions, your open tabs and this container's history. "
      + "For your own engine, put %s where the search terms go; the suggestions URL should return OpenSearch suggestions.",
    el("label", { className: "field" }, el("span", { textContent: "Engine" }), select), custom);
}
