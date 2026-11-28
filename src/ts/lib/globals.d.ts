/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Globals shared between the bundles. The background page publishes its
// modules on `globalThis.__macc*` so extension pages can reach them through
// chrome.extension.getBackgroundPage() (and so the e2e test can drive them).

import type { CompatApi } from "../compat";
import type { IsoApi } from "../background/isolation";
import type { HighlightApi } from "../background/highlight";
import type { HistoryApi } from "../background/history";
import type { TopSitesApi } from "../background/topsites";
import type { MoveDataApi } from "../background/movedata";
import type { ThemeApi } from "../background/theme";
import type { SearchApi } from "../background/search";
import type { WeatherApi } from "../background/weather";
import type { WallpaperApi } from "../background/wallpaper";

export interface BackgroundGlobals {
  __maccIso: IsoApi;
  __maccHighlight: HighlightApi;
  __maccHistory: HistoryApi;
  __maccTopSites: TopSitesApi;
  __maccMoveData: MoveDataApi;
  __maccTheme: ThemeApi;
  __maccSearch: SearchApi;
  __maccWeather: WeatherApi;
  __maccWallpaper: WallpaperApi;
  /** The build the background page runs (__MACC_BUILD__). */
  __maccBuild?: string;
  __maccCompat: CompatApi;
}
export type BackgroundWindow = Window & BackgroundGlobals;

declare global {
  var __maccCompat: CompatApi;
  var __maccIso: IsoApi;
  var __maccHighlight: HighlightApi;
  var __maccHistory: HistoryApi;
  var __maccTopSites: TopSitesApi;
  var __maccMoveData: MoveDataApi;
  var __maccTheme: ThemeApi;
  var __maccSearch: SearchApi;
  var __maccWeather: WeatherApi;
  var __maccWallpaper: WallpaperApi;
  var __maccBuild: string | undefined;
  /** Set at build time (build.mjs). */
  const __MACC_BUILD__: string;
  /** Upstream background (js/background/assignManager.js). */
  var assignManager: { storageArea: { isExempted(url: string, tabId: number): boolean } } | undefined;

  // Content-script hooks on the top window.
  interface Window {
    __maccSetBorder?: (color: string | null) => void;
  }

  // IndexedDB getAllRecords() (Chromium 141+): one call instead of a cursor
  // round trip per record, with direction support.
  interface IDBRecord<V = unknown> {
    readonly key: IDBValidKey;
    readonly primaryKey: IDBValidKey;
    readonly value: V;
  }
  interface IDBGetAllOptions {
    query?: IDBValidKey | IDBKeyRange | null;
    count?: number;
    direction?: IDBCursorDirection;
  }
  interface IDBIndex {
    getAllRecords?(options?: IDBGetAllOptions): IDBRequest<IDBRecord[]>;
  }
}
