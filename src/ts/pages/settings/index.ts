/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The settings page (replaces upstream's options page).

import { backgroundPage } from "../background";
import { settingsSections } from "./sections";

document.getElementById("sections")!.append(...settingsSections(backgroundPage()));
// The sections arrive after the browser looked for #weather and the like.
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
