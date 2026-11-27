/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Shared state of the per-container proxy module.

export const HOST = "io.github.jpdagostin0.macc_proxy";

export interface Route { type: string; host: string; port: number; username: string; password: string }

export const state = {
  enabled: false,                              // some container has a proxy
  helper: null as chrome.runtime.Port | null,  // native port
  port: 0,                                     // helper's listening port
  version: null as string | null,
  applied: false,                              // our PAC script is in effect
  control: null as string | null,              // proxy settings levelOfControl
  error: null as string | null,
  /** "n" -> upstream proxy of container n */
  routes: {} as Record<string, Route>,
};

/** The helper is up and the browser sends traffic to it. */
export const usable = () => state.enabled && !!state.port && state.applied;
