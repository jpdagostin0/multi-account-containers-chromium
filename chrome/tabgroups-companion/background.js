/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tab-group companion (Manifest V3) for Multi-Account Containers on Chromium.
//
// chrome.tabGroups (group color and title) is only exposed to Manifest V3
// extensions, so the MV2 extension asks this one to style the groups it
// creates. It accepts requests from that extension only and does nothing else.
const MAIN = "onhincpcieoahedkojoldccglpaokjln";

chrome.runtime.onMessageExternal.addListener((msg, sender, respond) => {
  if (sender.id !== MAIN || !msg) return false;
  (async () => {
    switch (msg.op) {
    case "ping":
      return { ok: true, version: chrome.runtime.getManifest().version };
    case "update":
      return { group: await chrome.tabGroups.update(msg.groupId, msg.props) };
    case "get":
      return { group: await chrome.tabGroups.get(msg.groupId) };
    case "query":
      return { groups: await chrome.tabGroups.query(msg.query || {}) };
    default:
      throw new Error(`unknown op ${msg.op}`);
    }
  })().then(respond, (e) => respond({ error: String(e && e.message || e) }));
  return true;
});
