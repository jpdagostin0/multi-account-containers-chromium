/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// One-off requests to the native helper (src/helper) for things only it can
// read, like the browser's theme and default search engine. Each request
// starts its own helper process; proxy routing keeps a separate long-lived
// connection (proxy/helper.ts).

import { HOST } from "./proxy/state";

/** The helper's reply, or null if it isn't installed or doesn't answer. */
export function askHelper<T extends object>(msg: Record<string, unknown>, timeoutMs = 5000): Promise<T | null> {
  const { promise, resolve } = Promise.withResolvers<T | null>();
  let port: chrome.runtime.Port;
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch {
    return Promise.resolve(null);
  }
  const done = (r: T | null) => { clearTimeout(timer); port.disconnect(); resolve(r); };
  const timer = setTimeout(() => done(null), timeoutMs);
  port.onMessage.addListener((m: { type?: string; id?: number }) => {
    if (m.type === "hello") port.postMessage({ ...msg, id: 1 });
    else if (m.id === 1) done(m as T);
  });
  port.onDisconnect.addListener(() => { void chrome.runtime.lastError; clearTimeout(timer); resolve(null); });
  return promise;
}
