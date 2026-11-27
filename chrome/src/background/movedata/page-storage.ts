/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Runs the in-page mover in a tab and waits for its report.

import type { StorageResult } from "./in-page/job";
import inPageSource from "./in-page?script";

const TIMEOUT = 30000;
const waiting = new Map<string, (r: Partial<StorageResult>) => void>();

chrome.runtime.onMessage.addListener((msg: { __macc?: string; id?: string; result?: StorageResult } | undefined) => {
  if (!msg || msg.__macc !== "moved") return;
  const cb = waiting.get(msg.id!);
  if (cb) {
    waiting.delete(msg.id!);
    cb(msg.result!);
  }
});

export function movePageStorage(tabId: number, from: number, to: number): Promise<Partial<StorageResult>> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const finish = (r: Partial<StorageResult>) => {
      clearTimeout(timer);
      waiting.delete(id);
      resolve(r);
    };
    const timer = setTimeout(() => finish({ errors: ["timed out"] }), TIMEOUT);
    waiting.set(id, finish);
    chrome.tabs.executeScript(tabId, { code: `(${inPageSource})(${JSON.stringify({ id, from, to })})` }, () => {
      const err = chrome.runtime.lastError;
      if (err) finish({ errors: [err.message || String(err)] });
    });
  });
}
