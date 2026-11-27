/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Container isolation engine for Chromium (Manifest V2, background page).
//
// Chromium has a single cookie jar per profile, so containers are emulated by
// renaming cookies inside it: a cookie `sid` set in container 3 is stored as
// `MACC3~sid`. Chromium still does all the real cookie work (domain/path
// matching, expiry, Secure, SameSite, HttpOnly); we just rewrite names:
//
//   request  Cookie:      keep only the context's own `MACC<n>~` cookies, unprefixed
//                         (default context: drop every `MACC*~` cookie)
//   response Set-Cookie:  prefix the name with the context's `MACC<n>~`
//   page JS:              content/main-world patches document.cookie,
//                         cookieStore, Web Storage, IndexedDB, Cache Storage
//                         and BroadcastChannel the same way
//
// Documents learn their container synchronously from `Server-Timing` entries
// added to every document response (readable through
// performance.getEntriesByType("navigation") at document_start):
//   macc;desc="<n>[|b]"          container number, b = service workers blocked
//   maccpurge;desc="<id>:<n>..." per-container storage wipes still to apply
// and remember it in the tab's sessionStorage, which also covers documents
// that never reach the network (service worker / cache) and session restore.

import { IDENT_KEY, SEED, csidOf, idOf, type IdentityState } from "../../lib/constants";
import { base } from "../base";
import { expect, unexpect } from "./assignment";
import { contextFor } from "./context";
import { allCookies, cookieUrl, purgeCookies } from "./cookies";
import "./identities";
import "./page-context";
import { PURGE_KEY, loadPurges, purgeStorage } from "./page-storage";
import { restore } from "./restore";
import { SW_KEY, loadSwOwners } from "./service-workers";
import {
  containerOf, hooks, identity, identityExists, identityList, listeners, mirror, navigationGuards,
  startup, status, tabs,
} from "./state";
import { setTabN } from "./tabs";
import { originOf } from "./urls";
import "./web-request";

export { allCookies, cookieUrl };

async function init(): Promise<void> {
  const all: Record<string, any> = await base.storage.local.get(null);
  Object.assign(mirror, all);
  loadSwOwners(all[SW_KEY]);
  loadPurges(all[PURGE_KEY]);
  if (!all[IDENT_KEY]) {
    // Materialise Firefox's default containers on first run.
    const seed: IdentityState = { nextId: SEED.length + 1, list: [...SEED] };
    mirror[IDENT_KEY] = seed;
    await base.storage.local.set({ [IDENT_KEY]: seed });
  }
  await restore();
  status.ready = true;
}

/** Public API for compat, the other background modules and the e2e test. */
export const iso = {
  get: (tabId: number) => csidOf(containerOf(tabId)),
  setTab: (tabId: number, csid: string) => setTabN(tabId, idOf(csid)),
  expect,
  unexpect,
  containerOf,
  contextFor,
  identityExists,
  identities: identityList,
  identity,
  originOf,
  purgeCookies,
  purgeStorage,
  navigationGuards,
  listeners,
  hooks,
  tabs,
  mirror,
  /** Resolves once storage has been loaded and tabs restored. */
  ready: init(),
  // Used by chrome/test/e2e.mjs to simulate a browser restart.
  debug: {
    forgetTab(tabId: number) {
      tabs.delete(tabId);
      startup.tabs.add(tabId);
    },
  },
};
export type IsoApi = typeof iso;
