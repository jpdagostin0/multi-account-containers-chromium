/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// "New tab search engine": the browser's default, or one of the user's own.

import type { SearchApi } from "../../background/search";
import { el } from "./dom";

export function searchEngineSection(search: SearchApi) {
  const field = (label: string, placeholder: string) => {
    const input = el("input", { type: "text", placeholder, spellcheck: false });
    input.style.inlineSize = "100%";
    return { input, node: el("label", { className: "macc-field" }, el("span", { className: "bold", textContent: label }), input) };
  };
  const name = field("Name", "e.g. DuckDuckGo");
  const url = field("Search URL", "https://duckduckgo.com/?q=%s");
  const suggestions = field("Suggestions URL (optional)", "https://duckduckgo.com/ac/?q=%s&type=list");
  const status = el("p", {});
  const save = el("button", { type: "button", textContent: "Use this engine" });
  const reset = el("button", { type: "button", textContent: "Use the browser's default" });
  const node = el("div", { id: "macc-search-engine", className: "settings-group" },
    el("h3", { textContent: "New tab search engine" }),
    el("p", {}, el("em", {
      textContent: "Searches and suggestions in the new tab page's search box. Put %s where the search terms go. "
        + "The suggestions URL should return OpenSearch suggestions (most engines have one).",
    })),
    name.node, url.node, suggestions.node, el("p", {}, save, " ", reset), status);

  async function load(): Promise<void> {
    const custom = await search.customEngine();
    const browser = await search.browserEngine();
    const shown = custom ?? browser;
    const toInput = (t: string | undefined) => (t ?? "").replace(/\{searchTerms\}/g, "%s");
    name.input.value = shown?.name ?? "";
    url.input.value = toInput(shown?.url);
    suggestions.input.value = toInput(shown?.suggestionsUrl);
    status.textContent = custom
      ? `Using ${custom.name}.`
      : browser ? `Using the browser's default engine, ${browser.name}.`
        : "Using the browser's default engine (without suggestions: the proxy helper isn't installed to look it up).";
    reset.hidden = !custom;
  }

  // The options page is one <form>: Enter saves this section instead of submitting it.
  for (const f of [name, url, suggestions]) {
    f.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save.click(); } });
  }
  save.addEventListener("click", async () => {
    try {
      await search.setCustomEngine({ name: name.input.value, url: url.input.value, suggestionsUrl: suggestions.input.value });
      await load();
    } catch (e) {
      status.textContent = (e as Error).message;
    }
  });
  reset.addEventListener("click", async () => {
    await search.setCustomEngine(null);
    await load();
  });
  load();
  return { node, render: () => {} };
}
