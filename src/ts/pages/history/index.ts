/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// History by container (Chromium port).

import { ff } from "../../lib/ff";
import { backgroundPage } from "../background";
import { listContainers } from "../containers";
import { filterButtons } from "./filters";
import { RowList } from "./rows";

const PAGE = 150;
const page = backgroundPage();
const hist = page.__maccHistory;
const me = await ff().tabs.getCurrent();
const containers = await listContainers();
const byN = new Map(containers.map((c) => [c.n, c]));

const params = new URLSearchParams(location.search);
let filter: number | null = params.has("container") ? Number(params.get("container")) : null;
if (filter !== null && !byN.has(filter)) filter = null;
let text = "";
let cursor = Infinity;

const more = document.getElementById("more")!;
const emptyNote = document.getElementById("empty")!;
const clearBtn = document.getElementById("clear")!;
const rows = new RowList(document.getElementById("list")!, byN, me.id!, hist, page.__maccTopSites);

const filters = filterButtons(containers, () => filter, (n) => {
  filter = n;
  const u = new URL(location.href);
  if (n === null) u.searchParams.delete("container");
  else u.searchParams.set("container", String(n));
  window.history.replaceState(null, "", u);
  reset();
});

let loading = false;
async function load(): Promise<void> {
  if (loading) return;
  loading = true;
  const list = await hist.query({ n: filter, text, before: cursor, limit: PAGE });
  list.forEach((v) => rows.append(v));
  if (list.length) cursor = list.at(-1)!.time;
  more.hidden = list.length < PAGE;
  emptyNote.hidden = !rows.empty;
  loading = false;
}

function reset(): void {
  rows.reset();
  cursor = Infinity;
  filters.refresh();
  clearBtn.textContent = filter === null ? "Clear all history" : `Clear ${byN.get(filter)!.name} history`;
  load();
}

more.addEventListener("click", load);
let debounce: ReturnType<typeof setTimeout> | undefined;
document.getElementById("q")!.addEventListener("input", (e) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => { text = (e.target as HTMLInputElement).value; reset(); }, 200);
});
clearBtn.addEventListener("click", async () => {
  const what = filter === null ? "all containers" : byN.get(filter)!.name;
  if (!confirm(`Delete the extension's history for ${what}? Chromium's own history is not affected.`)) return;
  await hist.clear(filter);
  reset();
});
reset();
