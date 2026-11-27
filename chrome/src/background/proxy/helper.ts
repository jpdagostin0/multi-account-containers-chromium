/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The local proxy helper (chrome/helper), over native messaging.

import { applyProxySettings, clearProxySettings } from "./browser-settings";
import { HOST, state } from "./state";

export interface HelperMessage { id?: number; type?: string; port?: number; version?: string; token?: string; error?: string }

let msgId = 0;
const waiting = new Map<number, (res: HelperMessage) => void>();
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectDelay = 1000;

export function call(msg: Record<string, unknown>): Promise<HelperMessage> {
  const { promise, resolve, reject } = Promise.withResolvers<HelperMessage>();
  if (!state.helper || !state.port) {
    reject(new Error("helper not running"));
    return promise;
  }
  const id = ++msgId;
  const timer = setTimeout(() => {
    waiting.delete(id);
    reject(new Error("helper timeout"));
  }, 5000);
  waiting.set(id, (res) => { clearTimeout(timer); resolve(res); });
  state.helper.postMessage({ ...msg, id });
  return promise;
}

/** Tell the helper the current routes, then point the browser at it. */
export const pushRoutes = () => call({ type: "routes", routes: state.routes }).then(applyProxySettings, () => {});

function onMessage(msg: HelperMessage): void {
  if (msg.type === "hello") {
    state.port = msg.port || 0;
    state.version = msg.version ?? null;
    state.error = null;
    reconnectDelay = 1000;
    pushRoutes();
    return;
  }
  const cb = msg.id !== undefined ? waiting.get(msg.id) : undefined;
  if (cb) {
    waiting.delete(msg.id!);
    cb(msg);
  }
}

function onDisconnect(): void {
  state.error = chrome.runtime.lastError?.message || "helper exited";
  state.helper = null;
  state.port = 0;
  waiting.forEach((cb) => cb({ error: state.error! }));
  waiting.clear();
  clearProxySettings();
  scheduleReconnect();
}

export function connectHelper(): void {
  clearTimeout(reconnectTimer);
  if (state.helper || !state.enabled) return;
  try {
    state.helper = chrome.runtime.connectNative(HOST);
  } catch (e) {
    state.error = String((e as Error).message || e);
    scheduleReconnect();
    return;
  }
  state.helper.onMessage.addListener(onMessage);
  state.helper.onDisconnect.addListener(onDisconnect);
}

function scheduleReconnect(): void {
  if (!state.enabled) return;
  reconnectTimer = setTimeout(connectHelper, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

export function retry(): void {
  reconnectDelay = 1000;
  connectHelper();
}

export function disconnectHelper(): void {
  state.helper?.disconnect();
  state.helper = null;
  state.port = 0;
}
