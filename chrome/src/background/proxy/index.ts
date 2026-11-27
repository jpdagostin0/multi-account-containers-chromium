/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Per-container proxies for Chromium (background page).
//
// Chromium has one proxy configuration per profile and PAC scripts never see
// the tab, so all traffic is sent to a local helper (chrome/helper, started
// through native messaging) and every connection is tagged with its
// container (connections.ts). The helper then routes the connection through
// the container's upstream proxy, or DIRECT. site-routes.ts keeps pooled
// connections from mixing containers.

import { iso } from "../isolation";
import "./connections";
import { retry } from "./helper";
import { holders, waitFlushed } from "./site-routes";
import { siteOf } from "./site";
import { HOST, state } from "./state";
import { update } from "./update";

/** Status for proxy-status.html and the options page. */
export const proxy = {
  status: () => ({
    enabled: state.enabled,
    helperRunning: !!state.port,
    version: state.version,
    applied: state.applied,
    control: state.control,
    error: state.error,
    host: HOST,
    extensionId: chrome.runtime.id,
    routes: Object.fromEntries(Object.entries(state.routes).map(([n, r]) => [n, `${r.type}://${r.host}:${r.port}`])),
  }),
  waitFlushed,
  retry,
  holdersOf: (site: string) => holders(site),
  siteOf,
};
export type ProxyApi = typeof proxy;

iso.ready.then(update);
