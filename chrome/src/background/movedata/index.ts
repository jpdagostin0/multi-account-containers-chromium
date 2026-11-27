/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// "Move site data to container" (Chromium port, background page):
//   cookies        renamed in the shared jar (cookies.ts)
//   page storage   localStorage, sessionStorage, IndexedDB and Cache Storage
//                  of the tab's origin, moved inside the tab (in-page/)

import { iso } from "../isolation";
import { buildMenu } from "./menu";
import { moveSiteData } from "./move";

export const moveData = { moveSiteData, buildMenu };
export type MoveDataApi = typeof moveData;

iso.ready.then(buildMenu);
