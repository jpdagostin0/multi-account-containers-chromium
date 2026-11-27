/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The history drawer, at the right.

import type { HistoryApi } from "../../background/history";
import type { TopSitesApi } from "../../background/topsites";
import { RowList } from "../history/rows";
import type { Container } from "../containers";
import { containerPicker } from "./container-picker";
import { setUpDrawer } from "./drawer";

const PAGE = 60;

export function setUpHistoryDrawer(containers: Container[], myN: number, tabId: number, hist: HistoryApi, top: TopSitesApi): void {
  const drawer = document.getElementById("history-drawer")!;
  const toggle = document.getElementById("history-toggle")!;
  const scroller = drawer.querySelector<HTMLElement>(".drawer-body")!;
  const fullLink = drawer.querySelector<HTMLAnchorElement>(".full-history")!;
  const emptyNote = drawer.querySelector<HTMLElement>(".empty")!;
  const sentinel = drawer.querySelector<HTMLElement>(".sentinel")!;
  const byN = new Map(containers.map((c) => [c.n, c]));
  const rows = new RowList(drawer.querySelector(".list")!, byN, tabId, hist, top);

  let cursor = Infinity;
  let done = false;
  let loading = false;
  let generation = 0;
  async function load(): Promise<void> {
    if (loading || done) return;
    loading = true;
    const gen = generation;
    const list = await hist.query({ n: picker.value, before: cursor, limit: PAGE });
    loading = false;
    if (gen !== generation) return load();
    list.forEach((v) => rows.append(v));
    if (list.length) cursor = list.at(-1)!.time;
    done = list.length < PAGE;
    emptyNote.hidden = !rows.empty;
  }
  function reset(): void {
    generation++;
    rows.reset();
    cursor = Infinity;
    done = false;
    drawer.dataset.filter = picker.value === null ? "all" : String(picker.value);
    fullLink.href = picker.value === null ? "history.html" : `history.html?container=${picker.value}`;
    scroller.scrollTop = 0;
    load();
  }
  new IntersectionObserver((e) => { if (e[0]!.isIntersecting && isOpen()) load(); }, { root: scroller, rootMargin: "300px" })
    .observe(sentinel);

  const picker = containerPicker(containers, reset);
  picker.set(byN.has(myN) ? myN : null);
  drawer.querySelector(".drawer-head")!.prepend(picker.el);

  const { isOpen } = setUpDrawer({
    drawer, toggle, side: "end", openClass: "history-open", onOpen: reset,
    focus: () => drawer.querySelector<HTMLElement>(".picker-button"),
  });
}
