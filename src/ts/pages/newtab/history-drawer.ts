/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The history drawer, at the right: history by container, searchable.

import type { HistoryApi } from "../../background/history";
import type { TopSitesApi } from "../../background/topsites";
import type { Container } from "../containers";
import { containerPicker } from "./container-picker";
import { setUpDrawer } from "./drawer";
import { RowList } from "./history-rows";

const PAGE = 60;

/** Returns a function that opens the drawer, filtered to a container if given. */
export function setUpHistoryDrawer(containers: Container[], myN: number, tabId: number, hist: HistoryApi, top: TopSitesApi): (n?: number) => void {
  const drawer = document.getElementById("history-drawer")!;
  const toggle = document.getElementById("history-toggle")!;
  const scroller = drawer.querySelector<HTMLElement>(".drawer-body")!;
  const emptyNote = drawer.querySelector<HTMLElement>(".empty")!;
  const sentinel = drawer.querySelector<HTMLElement>(".sentinel")!;
  const search = drawer.querySelector<HTMLInputElement>(".history-q")!;
  const clearBtn = drawer.querySelector<HTMLButtonElement>(".clear-history")!;
  const byN = new Map(containers.map((c) => [c.n, c]));
  const rows = new RowList(drawer.querySelector(".list")!, byN, tabId, hist, top);

  let text = "";
  let cursor = Infinity;
  let done = false;
  let loading = false;
  let generation = 0;
  async function load(): Promise<void> {
    if (loading || done) return;
    loading = true;
    const gen = generation;
    const list = await hist.query({ n: picker.value, text, before: cursor, limit: PAGE });
    loading = false;
    if (gen !== generation) return load();
    list.forEach((v) => rows.append(v));
    if (list.length) cursor = list.at(-1)!.time;
    done = list.length < PAGE;
    emptyNote.hidden = !rows.empty;
    emptyNote.textContent = text ? "Nothing in history matches." : "No history here yet.";
  }
  function reset(): void {
    generation++;
    rows.reset();
    cursor = Infinity;
    done = false;
    drawer.dataset.filter = picker.value === null ? "all" : String(picker.value);
    clearBtn.textContent = picker.value === null ? "Clear all" : `Clear ${byN.get(picker.value)!.name}`;
    scroller.scrollTop = 0;
    load();
  }
  new IntersectionObserver((e) => { if (e[0]!.isIntersecting && isOpen()) load(); }, { root: scroller, rootMargin: "300px" })
    .observe(sentinel);

  const picker = containerPicker(containers, reset);
  picker.set(byN.has(myN) ? myN : null);
  drawer.querySelector(".drawer-head")!.prepend(picker.el);

  let debounce: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { text = search.value.trim(); reset(); }, 200);
  });
  clearBtn.addEventListener("click", async () => {
    const what = picker.value === null ? "all containers" : byN.get(picker.value)!.name;
    if (!confirm(`Delete the extension's history for ${what}? Chromium's own history is not affected.`)) return;
    await hist.clear(picker.value);
    reset();
  });

  const { isOpen, setOpen } = setUpDrawer({
    drawer, toggle, side: "end", openClass: "history-open", onOpen: reset,
    focus: () => drawer.querySelector<HTMLElement>(".picker-button"),
  });
  return (n) => {
    if (n !== undefined && byN.has(n) && n !== picker.value) {
      picker.set(n);
      if (isOpen()) reset();
    }
    setOpen(true);
  };
}
