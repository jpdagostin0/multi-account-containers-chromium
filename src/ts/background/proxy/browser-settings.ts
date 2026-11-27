/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The browser's proxy configuration: a PAC script sending everything (but
// loopback) to the helper, plus WebRTC/DNS-prefetch settings that would
// otherwise leak around it.

import { lastError } from "../../lib/constants";
import { state } from "./state";

type Setting = chrome.types.ChromeSetting<any>;

function pac(port: number): string {
  return `function FindProxyForURL(url, host) {
  if (isPlainHostName(host) || host === "localhost" || /^127\\./.test(host) || host === "[::1]") return "DIRECT";
  return "PROXY 127.0.0.1:${port}";
}`;
}

function setSetting(setting: Setting | undefined, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    if (!setting) return resolve();
    setting.set({ value, scope: "regular" }, () => { lastError(); resolve(); });
  });
}

function clearSetting(setting: Setting | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!setting) return resolve();
    setting.clear({ scope: "regular" }, () => { lastError(); resolve(); });
  });
}

function refreshControl(): Promise<void> {
  return new Promise((resolve) => {
    chrome.proxy.settings.get({ incognito: false }, (details) => {
      lastError();
      state.control = details?.levelOfControl ?? null;
      state.applied = !!details && details.levelOfControl === "controlled_by_this_extension"
        && details.value?.mode === "pac_script";
      resolve();
    });
  });
}
chrome.proxy.settings.onChange.addListener(() => { refreshControl(); });

export async function clearProxySettings(): Promise<void> {
  state.applied = false;
  await clearSetting(chrome.proxy.settings);
  const net = chrome.privacy?.network;
  if (net) {
    await clearSetting(net.webRTCIPHandlingPolicy);
    await clearSetting(net.networkPredictionEnabled);
  }
}

export async function applyProxySettings(): Promise<void> {
  if (!state.enabled || !state.port) return clearProxySettings();
  await setSetting(chrome.proxy.settings, { mode: "pac_script", pacScript: { data: pac(state.port), mandatory: true } });
  const net = chrome.privacy?.network;
  if (net) {
    await setSetting(net.webRTCIPHandlingPolicy, "disable_non_proxied_udp");
    await setSetting(net.networkPredictionEnabled, false);
  }
  await refreshControl();
}
