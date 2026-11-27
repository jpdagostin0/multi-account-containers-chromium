/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Moves the tab origin's page storage between containers. Injected with
// tabs.executeScript (as source: `import ... from "./in-page?script"`), so
// it runs in the tab's isolated world and sees the raw, prefixed names.
// Reports back with a { __macc: "moved" } message.

import { moveCaches } from "./caches";
import { moveIndexedDB } from "./indexed-db";
import { renamer, type Job, type StorageResult } from "./job";
import { moveWebStorage } from "./web-storage";

async function run(job: Job): Promise<StorageResult> {
  const names = renamer(job);
  const result: StorageResult = { localStorage: 0, sessionStorage: 0, indexedDB: 0, caches: 0, errors: [] };
  try { result.localStorage = moveWebStorage(localStorage, names); } catch (e) { result.errors.push(`localStorage: ${e}`); }
  try { result.sessionStorage = moveWebStorage(sessionStorage, names); } catch (e) { result.errors.push(`sessionStorage: ${e}`); }
  try { result.indexedDB = await moveIndexedDB(names); } catch (e) { result.errors.push(`indexedDB: ${e}`); }
  try { result.caches = await moveCaches(names); } catch (e) { result.errors.push(`caches: ${e}`); }
  return result;
}

export default function movePageStorage(job: Job): void {
  run(job).then((result) => chrome.runtime.sendMessage({ __macc: "moved", id: job.id, result }));
}
