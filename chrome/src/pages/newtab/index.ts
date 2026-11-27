/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// New tab page: top sites per container (Chromium port).

import { DEFAULT, idOf } from "../../lib/constants";
import { ff } from "../../lib/ff";
import { backgroundPage } from "../background";
import { listContainers } from "../containers";
import { setUpContainerTabs } from "./container-tabs";
import { setUpHistoryDrawer } from "./history-drawer";
import { setUpSearch } from "./search";
import { section } from "./sections";

const page = backgroundPage();
const top = page.__maccTopSites;
const me = await ff().tabs.getCurrent();
const myN = idOf(me?.cookieStoreId ?? DEFAULT);

// This tab's container first, then the rest in the panel's order.
const containers = await listContainers();
const sections = [...containers].sort((a, b) => Number(b.n === myN) - Number(a.n === myN));
const mine = sections.find((s) => s.n === myN);
if (mine?.color) document.documentElement.style.setProperty("--accent", mine.color);

setUpSearch(me.id!, mine, top);
setUpContainerTabs(containers, myN, me.id!, top);
setUpHistoryDrawer(containers, myN, me.id!, page.__maccHistory, top);

const lists = await top.list(16);
const root = document.getElementById("sections")!;
for (const s of sections) {
  const tiles = lists[String(s.n)] || [];
  if (tiles.length || s.n === myN) root.append(section(s, tiles, s.n === myN, me.id!, top));
}
