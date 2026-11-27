/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The history drawer: slides in from the side, the page shrinks beside it.

import type { HistoryApi } from "../../background/history";
import type { TopSitesApi } from "../../background/topsites";
import { RowList } from "../history/rows";
import type { Container } from "../containers";
import { containerPicker } from "./container-picker";

const PAGE = 60;

export function setUpHistoryDrawer(containers: Container[], myN: number, tabId: number, hist: HistoryApi, top: TopSitesApi): void {
  const root = document.documentElement;
  const drawer = document.getElementById("history-drawer")!;
  const toggle = document.getElementById("history-toggle")!;
  const main = document.querySelector("main")!;
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

  // Shrink the page into the space left of the drawer, centred there.
  function fit(): void {
    const free = innerWidth - drawer.offsetWidth;
    const scale = Math.min(1, (free - 16) / main.offsetWidth);
    root.style.setProperty("--page-shift", `${(free - innerWidth) / 2}px`);
    root.style.setProperty("--page-scale", String(Math.max(scale, 0.4)));
  }
  addEventListener("resize", fit);

  const isOpen = () => root.classList.contains("history-open");
  function setOpen(open: boolean): void {
    if (open === isOpen()) return;
    if (open) {
      fit();
      reset();
    }
    root.classList.toggle("history-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    drawer.inert = !open;
    if (open) drawer.querySelector<HTMLElement>(".picker-button")!.focus({ preventScroll: true });
  }
  drawer.inert = true;
  toggle.addEventListener("click", () => setOpen(!isOpen()));
  drawer.querySelector(".close")!.addEventListener("click", () => { setOpen(false); toggle.focus(); });
  main.addEventListener("click", (e) => { if (isOpen()) { e.preventDefault(); e.stopPropagation(); setOpen(false); } }, true);
  addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) setOpen(false); });
}
