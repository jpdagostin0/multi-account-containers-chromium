/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// History rows, grouped under day headings.

import type { HistoryApi, Visit } from "../../background/history";
import type { TopSitesApi } from "../../background/topsites";
import { cloneTemplate, hostLabel, openInBackground, showFavicon, type Container } from "../containers";

type Row = Visit & { icon: string | null };

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

function dayLabel(t: number): string {
  const d = new Date(t).toDateString();
  if (d === new Date().toDateString()) return "Today";
  if (d === new Date(Date.now() - 864e5).toDateString()) return "Yesterday";
  return dayFmt.format(t);
}

export class RowList {
  private lastDay: string | null = null;
  constructor(
    private list: HTMLElement,
    private byN: Map<number, Container>,
    private tabId: number,
    private hist: HistoryApi,
    private top: TopSitesApi,
  ) {}

  reset(): void {
    this.list.replaceChildren();
    this.lastDay = null;
  }

  get empty(): boolean {
    return this.list.childElementCount === 0;
  }

  append(v: Row): void {
    const label = dayLabel(v.time);
    if (label !== this.lastDay) {
      const h = document.createElement("h2");
      h.className = "day";
      h.textContent = label;
      this.list.append(h);
      this.lastDay = label;
    }
    this.list.append(this.row(v));
  }

  private row(v: Row): HTMLElement {
    const c = this.byN.get(v.n) || this.byN.get(0)!;
    const row = cloneTemplate("row-tpl");
    if (c.color) row.style.setProperty("--c", c.color);
    const time = row.querySelector("time")!;
    time.textContent = timeFmt.format(v.time);
    time.dateTime = new Date(v.time).toISOString();
    showFavicon(row.querySelector<HTMLElement>(".favicon")!, v.url, v.icon);
    const a = row.querySelector<HTMLAnchorElement>(".text")!;
    a.href = v.url;
    a.title = v.url;
    row.querySelector(".title")!.textContent = v.title || hostLabel(v.url);
    row.querySelector(".host")!.textContent = v.url.replace(/^https?:\/\//, "");
    row.querySelector(".badge")!.textContent = c.name;
    // Open in the container the visit happened in.
    a.addEventListener("click", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) openInBackground(v.url, c.csid);
      else this.top.openInTab(this.tabId, c.csid, v.url);
    });
    a.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      openInBackground(v.url, c.csid);
    });
    row.querySelector(".del")!.addEventListener("click", async () => {
      await this.hist.remove([v.id]);
      row.remove();
    });
    return row;
  }
}
