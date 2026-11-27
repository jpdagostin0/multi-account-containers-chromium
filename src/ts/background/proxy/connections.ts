/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tagging connections: the helper answers each new CONNECT / plain-HTTP
// request with 407, and onAuthRequired, which knows the tab, answers with a
// one-time token the helper minted for that request's container.
// A proxied container must never fall back to a direct connection.

import { csidOf } from "../../lib/constants";
import { iso } from "../isolation";
import { call } from "./helper";
import { tabSites } from "./site-routes";
import { siteOf } from "./site";
import { state, usable } from "./state";
import { statusPage } from "./status-page";

const fromHelper = (d: chrome.webRequest.OnAuthRequiredDetails) =>
  d.isProxy && !!state.port && d.challenger?.port === state.port
  && /^(127\.0\.0\.1|localhost)$/.test(d.challenger.host);

chrome.webRequest.onAuthRequired.addListener((d, callback) => {
  if (!fromHelper(d)) {
    callback!({});
    return;
  }
  const n = iso.contextFor(d);
  const site = d.type === "main_frame" ? siteOf(d.url)
    : tabSites.get(d.tabId)?.site || siteOf(d.initiator || d.url) || "";
  call({ type: "token", ctx: String(n), site })
    .then((res) => callback!(res.token
      ? { authCredentials: { username: "macc", password: res.token } }
      : { cancel: true }))
    .catch(() => callback!({ cancel: true }));
}, { urls: ["<all_urls>"] }, ["asyncBlocking"]);

chrome.webRequest.onBeforeRequest.addListener((d) => {
  if (!state.enabled || usable() || !/^(https?|wss?):/.test(d.url)) return {};
  const n = iso.contextFor(d);
  if (!state.routes[String(n)]) return {};
  if (d.type === "main_frame") return { redirectUrl: statusPage("unavailable", d.url, { ctx: csidOf(n) }) };
  return { cancel: true };
}, { urls: ["<all_urls>"] }, ["blocking"]);
