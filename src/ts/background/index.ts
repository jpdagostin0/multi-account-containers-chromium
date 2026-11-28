/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Background page entry: the Chromium-specific modules, loaded after
// compat.js and before the upstream background scripts. Each module is
// published on globalThis so extension pages (getBackgroundPage()) and the
// e2e test can reach it.

import { highlight } from "./highlight";
import { history } from "./history";
import { iso } from "./isolation";
import { moveData } from "./movedata";
import { search } from "./search";
import { theme } from "./theme";
import { topSites } from "./topsites";
import { wallpaper } from "./wallpaper";
import { weather } from "./weather";

globalThis.__maccIso = iso;
globalThis.__maccHighlight = highlight;
globalThis.__maccMoveData = moveData;
globalThis.__maccHistory = history;
globalThis.__maccTopSites = topSites;
globalThis.__maccTheme = theme;
globalThis.__maccSearch = search;
globalThis.__maccWeather = weather;
globalThis.__maccWallpaper = wallpaper;
globalThis.__maccBuild = __MACC_BUILD__;
