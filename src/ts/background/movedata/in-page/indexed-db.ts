/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// IndexedDB databases can't be renamed: copy schema and data to the target
// name, then delete the source.

import { req } from "../../../lib/idb";
import type { Renamer } from "./job";

interface StoreSchema {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[];
}

function schemaOf(db: IDBDatabase): StoreSchema[] {
  return [...db.objectStoreNames].map((name) => {
    const s = db.transaction(name, "readonly").objectStore(name);
    return {
      name,
      keyPath: s.keyPath,
      autoIncrement: s.autoIncrement,
      indexes: [...s.indexNames].map((i) => {
        const ix = s.index(i);
        return { name: i, keyPath: ix.keyPath, unique: ix.unique, multiEntry: ix.multiEntry };
      }),
    };
  });
}

type Data = Record<string, { keys: IDBValidKey[]; values: unknown[] }>;

/** Everything, in one read transaction over every store. */
async function readAll(db: IDBDatabase, schema: StoreSchema[]): Promise<Data> {
  const data: Data = {};
  if (!schema.length) return data;
  const tx = db.transaction(schema.map((s) => s.name), "readonly");
  await Promise.all(schema.map(async (st) => {
    const s = tx.objectStore(st.name);
    const [keys, values] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]);
    data[st.name] = { keys, values };
  }));
  return data;
}

async function create(name: string, version: number, schema: StoreSchema[]): Promise<IDBDatabase> {
  await req(indexedDB.deleteDatabase(name));
  const open = indexedDB.open(name, version);
  open.onupgradeneeded = () => {
    for (const st of schema) {
      const os = open.result.createObjectStore(st.name, { keyPath: st.keyPath, autoIncrement: st.autoIncrement });
      for (const ix of st.indexes) os.createIndex(ix.name, ix.keyPath, { unique: ix.unique, multiEntry: ix.multiEntry });
    }
  };
  return req(open);
}

/** One write transaction; relaxed durability skips the per-commit flush. */
async function writeAll(db: IDBDatabase, schema: StoreSchema[], data: Data): Promise<void> {
  if (!schema.length) return;
  const tx = db.transaction(schema.map((s) => s.name), "readwrite", { durability: "relaxed" });
  for (const st of schema) {
    const os = tx.objectStore(st.name);
    const { keys, values } = data[st.name]!;
    values.forEach((v, i) => (st.keyPath === null ? os.put(v, keys[i]) : os.put(v)));
  }
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
}

async function copyDb(srcName: string, dstName: string): Promise<void> {
  const src = await req(indexedDB.open(srcName));
  const schema = schemaOf(src);
  const data = await readAll(src, schema);
  const version = src.version;
  src.close();
  const dst = await create(dstName, version, schema);
  await writeAll(dst, schema, data);
  dst.close();
  await req(indexedDB.deleteDatabase(srcName));
}

/** Returns how many databases moved. */
export async function moveIndexedDB({ isSource, rename }: Renamer): Promise<number> {
  let n = 0;
  for (const d of (await indexedDB.databases()).filter((x) => isSource(x.name))) {
    await copyDb(d.name!, rename(d.name!));
    n++;
  }
  return n;
}
