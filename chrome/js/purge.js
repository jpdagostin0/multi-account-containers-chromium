/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Per-container wipe of an origin's page storage. Shared by the background
// page (injected into open tabs via tabs.executeScript) and the main-world
// shim (applied at document_start, before the page's own scripts run).
// Must only touch the real, unpatched storage APIs.
//
// list: [{id, n}] — wipe container n's entries; n = 0 is the default
// context (unprefixed names). Applied ids are recorded in the origin's
// localStorage so every wipe runs once per origin.
globalThis.__maccPurgeInPage = function maccPurge(list) {
  "use strict";
  const ANY = /^MACC(\d+)~/;
  const INTERNAL = "MACC0~";
  const ACK = "MACC0~purged";
  let done = [];
  try { done = JSON.parse(localStorage.getItem(ACK) || "[]"); } catch { /* storage blocked */ }
  const todo = list.filter((p) => !done.includes(p.id));
  if (!todo.length) return;
  const wanted = new Set(todo.map((p) => Number(p.n)));
  const doomed = (name) => {
    if (typeof name !== "string" || name.startsWith(INTERNAL)) return false;
    const m = ANY.exec(name);
    return wanted.has(m ? Number(m[1]) : 0);
  };
  for (const get of [() => localStorage, () => sessionStorage]) {
    try {
      const store = get();
      const keys = [];
      for (let i = 0; i < store.length; i++) keys.push(store.key(i));
      keys.filter(doomed).forEach((k) => store.removeItem(k));
    } catch { /* storage blocked */ }
  }
  try {
    indexedDB.databases().then((dbs) => dbs.forEach((d) => {
      if (doomed(d.name)) indexedDB.deleteDatabase(d.name);
    }), () => {});
  } catch { /* unavailable */ }
  try {
    caches.keys().then((names) => names.forEach((name) => {
      if (doomed(name)) caches.delete(name);
    }), () => {});
  } catch { /* unavailable */ }
  try {
    localStorage.setItem(ACK, JSON.stringify([...done, ...todo.map((p) => p.id)].slice(-500)));
  } catch { /* storage blocked */ }
};
