/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Per-container history and saved favicons (Chromium port, background page).
//
// Chromium's history is shared by every container, so the extension keeps
// its own (record.ts) in IndexedDB, with the site icons the new tab page and
// its history drawer show (site-icons.ts).

import { clear, prune, remove } from "./delete";
import "./menu";
import { query } from "./query";
import "./record";
import { iconsFor, migrateLegacyIcons, reportOpenTabs, saveIcon } from "./site-icons";

export type { Visit } from "./db";

export const history = { query, remove, clear, iconsFor, prune, saveIcon };
export type HistoryApi = typeof history;

migrateLegacyIcons().catch(() => {});
reportOpenTabs().catch(() => {});
prune().catch(() => {});
setInterval(() => prune().catch(() => {}), 6 * 3600e3);
