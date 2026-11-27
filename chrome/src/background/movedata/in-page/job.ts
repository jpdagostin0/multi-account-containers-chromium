/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// What to move and how names map, for the in-page mover.

export interface Job { id: string; from: number; to: number }
export interface StorageResult { localStorage: number; sessionStorage: number; indexedDB: number; caches: number; errors: string[] }

const ANY = /^MACC(\d+)~/;
const pre = (n: number) => (n ? `MACC${n}~` : "");

export interface Renamer {
  /** Is this raw name source data? */
  isSource(name: unknown): name is string;
  /** Source name -> target name. */
  rename(name: string): string;
}

export function renamer(job: Job): Renamer {
  const ctx = (name: string) => {
    const m = ANY.exec(name);
    return m ? Number(m[1]) : 0;
  };
  return {
    isSource: (name): name is string => typeof name === "string" && ctx(name) === job.from
      && !(job.from === 0 && name.startsWith("MACC0~")),
    rename: (name) => pre(job.to) + name.slice(pre(job.from).length),
  };
}
