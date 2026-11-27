/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// browser.browsingData with Firefox's per-container cookieStoreId option.

import { DEFAULT } from "../lib/constants";
import { iso } from "./background";
import { base } from "./base";

interface RemovalOptions { cookieStoreId?: string; hostnames?: string[] }

export const browsingData = {
  ...(base.browsingData || {}),
  async removeCookies(options: RemovalOptions = {}) {
    return iso().purgeCookies(options.cookieStoreId || DEFAULT, options.hostnames);
  },
  async removeLocalStorage(options: RemovalOptions = {}) {
    // Wipes only this container's page storage.
    return iso().purgeStorage(options.cookieStoreId || DEFAULT, options.hostnames);
  },
};
