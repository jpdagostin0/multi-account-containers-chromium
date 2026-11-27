/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// (Re)configures everything when containers' proxy settings change.

import { IDENT_KEY } from "../../lib/constants";
import { clearProxySettings } from "./browser-settings";
import { connectHelper, disconnectHelper, pushRoutes } from "./helper";
import { readRoutes } from "./routes";
import { state } from "./state";

export async function update(): Promise<void> {
  state.routes = readRoutes();
  state.enabled = Object.keys(state.routes).length > 0;
  if (!state.enabled) {
    disconnectHelper();
    await clearProxySettings();
    return;
  }
  if (!state.helper) connectHelper();
  else if (state.port) pushRoutes();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.proxifiedContainersKey || changes[IDENT_KEY])) {
    // The isolation engine updates its mirror from the same event; let it run first.
    setTimeout(update, 0);
  }
});
