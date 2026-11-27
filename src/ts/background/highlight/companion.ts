/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The tab-group companion: chrome.tabGroups is MV3-only, so a small MV3
// extension colors and titles the groups for us.

export const COMPANION = "jeedhomnaldfldmfkfekpifefpfcpbll";

export interface CompanionGroup { id: number; title?: string; color: string; windowId: number }
interface Reply { error?: string; version?: string; groups?: CompanionGroup[] }

export const companion = { available: false, version: null as string | null, error: null as string | null };

export function ask(msg: Record<string, unknown>): Promise<Reply> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(COMPANION, msg, (res?: Reply) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      if (!res) return reject(new Error("no response"));
      if (res.error) return reject(new Error(res.error));
      resolve(res);
    });
  });
}

export async function pingCompanion(): Promise<boolean> {
  try {
    const res = await ask({ op: "ping" });
    companion.available = true;
    companion.version = res.version ?? null;
    companion.error = null;
  } catch (e) {
    companion.available = false;
    companion.error = (e as Error).message;
  }
  return companion.available;
}
