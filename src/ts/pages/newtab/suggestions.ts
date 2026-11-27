/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Suggestions under the search box: what was typed, the default engine's
// suggestions, matching open tabs (switch to them) and matching history from
// this tab's container. Arrow keys move through them, Enter picks one.

import type { HistoryApi } from "../../background/history";
import type { SearchApi } from "../../background/search";
import type { TopSitesApi } from "../../background/topsites";
import { ff } from "../../lib/ff";
import { hostLabel, showFavicon, type Container } from "../containers";
import type { Go } from "./search";

const MAX_HISTORY = 4;
const DEBOUNCE = 60;

interface Item { kind: "search" | "tab" | "history"; text: string; sub?: string; url?: string; icon?: string | null; act(): void }

interface Deps {
  tabId: number;
  mine: Container | undefined;
  byCsid: Map<string, Container>;
  search: SearchApi;
  hist: HistoryApi;
  top: TopSitesApi;
  go: Go;
}

export function setUpSuggestions({ tabId, mine, byCsid, search, hist, top, go }: Deps): void {
  const q = document.getElementById("q") as HTMLInputElement;
  const form = document.getElementById("search")!;
  const list = document.getElementById("suggest")!;
  const myN = mine?.n ?? 0;
  let items: Item[] = [];
  let sel = -1;
  let typed = "";
  let seq = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  /** The engine's last answer, kept while the next one loads. */
  let engineFor = { text: "", list: [] as string[] };

  const searchItem = (text: string): Item => ({ kind: "search", text, act: () => go(text) });

  function render(): void {
    list.replaceChildren(...items.map((it, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.dataset.kind = it.kind;
      li.setAttribute("aria-selected", String(i === sel));
      const icon = document.createElement("span");
      icon.className = "s-icon";
      if (it.kind === "search") icon.classList.add("glass");
      else showFavicon(icon, it.url!, it.icon);
      const text = document.createElement("span");
      text.className = "s-text";
      text.textContent = it.text;
      li.append(icon, text);
      if (it.sub) {
        const sub = document.createElement("span");
        sub.className = "s-sub";
        sub.textContent = it.sub;
        li.append(sub);
      }
      if (it.kind === "tab") {
        const tag = document.createElement("span");
        tag.className = "s-tag";
        tag.textContent = "Switch to tab";
        li.append(tag);
      }
      // mousedown, so the input keeps focus and doesn't close the list first.
      li.addEventListener("mousedown", (e) => { e.preventDefault(); it.act(); });
      li.addEventListener("mousemove", () => { if (sel !== i) { sel = i; mark(); } });
      return li;
    }));
    const open = items.length > 1 || (items.length === 1 && items[0]!.kind !== "search");
    list.hidden = !open;
    form.classList.toggle("suggesting", open);
    q.setAttribute("aria-expanded", String(open));
  }

  function mark(): void {
    [...list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === sel)));
  }

  function close(): void {
    seq++;
    items = [];
    sel = -1;
    render();
  }

  async function update(text: string): Promise<void> {
    const ticket = ++seq;
    if (!text.trim()) return close();
    const [tabs, visits] = await Promise.all([search.tabs(text, tabId), hist.query({ n: myN, text, limit: 20 })]);
    if (ticket !== seq) return;
    const tabUrls = new Set(tabs.map((t) => t.url));
    const seen = new Set<string>();
    const history: Item[] = [];
    for (const v of visits) {
      if (history.length >= MAX_HISTORY) break;
      if (seen.has(v.url) || tabUrls.has(v.url)) continue;
      seen.add(v.url);
      history.push({
        kind: "history", text: v.title || hostLabel(v.url), sub: v.url.replace(/^https?:\/\//, ""), url: v.url, icon: v.icon,
        act: () => top.openInTab(tabId, mine?.csid ?? "firefox-default", v.url),
      });
    }
    const tabItems: Item[] = tabs.map((t) => {
      const c = byCsid.get(t.cookieStoreId);
      return {
        kind: "tab", text: t.title, sub: c && c.n ? c.name : hostLabel(t.url), url: t.url, icon: t.favIconUrl,
        act: async () => {
          await search.switchTo(t.id, t.windowId);
          ff().tabs.remove(tabId);
        },
      };
    });
    const local = [...tabItems, ...history];
    const show = (engineList: string[]) => {
      items = [searchItem(text), ...engineList.map(searchItem), ...local];
      if (sel >= items.length) sel = -1;
      render();
    };
    // Until the engine answers, keep its earlier suggestions that still fit.
    show(engineFor.list.filter((s) => s.toLowerCase().startsWith(text.toLowerCase()) && s !== text));
    const fresh = await search.suggest(text);
    if (ticket !== seq) return;
    engineFor = { text, list: fresh };
    show(fresh);
  }
  q.setAttribute("role", "combobox");
  q.setAttribute("aria-autocomplete", "list");
  q.setAttribute("aria-controls", "suggest");
  q.setAttribute("aria-expanded", "false");
  q.addEventListener("input", () => {
    typed = q.value;
    sel = -1;
    clearTimeout(debounce);
    debounce = setTimeout(() => update(typed), DEBOUNCE);
  });
  q.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = items.length;
      sel = e.key === "ArrowDown" ? (sel + 1 >= n ? -1 : sel + 1) : (sel - 1 < -1 ? n - 1 : sel - 1);
      // Search rows fill the box with their text, like the omnibox.
      const it = items[sel];
      q.value = it?.kind === "search" ? it.text : typed;
      mark();
    } else if (e.key === "Enter" && sel >= 0) {
      e.preventDefault();
      items[sel]!.act();
    } else if (e.key === "Escape") {
      e.preventDefault();
      q.value = typed;
      close();
    }
  });
  q.addEventListener("blur", () => setTimeout(close, 100));
  q.addEventListener("focus", () => { if (q.value.trim()) update(q.value); });
}
