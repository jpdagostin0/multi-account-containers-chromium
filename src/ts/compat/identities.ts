/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// browser.contextualIdentities, stored in storage.local. Mutations run in
// the background page; events are derived from storage changes so every
// page sees them.

import {
  COLORS, ICONS, IDENT_KEY, SEED, colorCode, csidOf, idOf, isColor, isIcon,
  type IdentityRec, type IdentityState,
} from "../lib/constants";
import { makeEvent } from "../lib/events";
import { bg, clone, isBackground } from "./background";
import { base } from "./base";

export interface ContextualIdentity {
  cookieStoreId: string;
  name: string;
  color: string;
  colorCode: string;
  icon: string;
  iconUrl: string;
}
interface IdentityDetails { name?: string; color?: string; icon?: string }

function toIdentity(rec: IdentityRec): ContextualIdentity {
  return {
    cookieStoreId: csidOf(rec.id),
    name: rec.name,
    color: rec.color,
    colorCode: colorCode(rec.color),
    icon: rec.icon,
    iconUrl: base.runtime.getURL(`img/usercontext.svg#${rec.icon}`),
  };
}

async function readState(): Promise<IdentityState | null> {
  const r = await base.storage.local.get(IDENT_KEY);
  return (r[IDENT_KEY] as IdentityState | undefined) ?? null;
}

// Serialized so concurrent writers can't clobber each other.
let chain: Promise<unknown> = Promise.resolve();
function mutate<T>(fn: (state: IdentityState) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const state = (await readState()) ?? { nextId: 5, list: clone([...SEED]) };
    const result = await fn(state);
    await base.storage.local.set({ [IDENT_KEY]: state });
    return result;
  });
  chain = run.catch(() => {});
  return run;
}

const invalid = (csid: string) => new Error(`Invalid contextual identity: ${csid}`);

/** The implementation; non-background pages call it in the background page. */
export const ciImpl = {
  async query(details: { name?: string } = {}): Promise<ContextualIdentity[]> {
    const state = await readState();
    let list = state ? state.list : SEED;
    if (details && details.name !== undefined) list = list.filter((r) => r.name === details.name);
    return list.map(toIdentity);
  },
  async get(csid: string): Promise<ContextualIdentity> {
    const id = idOf(csid);
    const state = await readState();
    const rec = (state ? state.list : SEED).find((r) => r.id === id);
    if (!rec) throw invalid(csid);
    return toIdentity(rec);
  },
  create(details: IdentityDetails): Promise<ContextualIdentity> {
    return mutate((state) => {
      const rec: IdentityRec = {
        id: state.nextId++,
        name: String(details.name || ""),
        color: isColor(details.color) ? details.color : "blue",
        icon: isIcon(details.icon) ? details.icon : "circle",
      };
      state.list.push(rec);
      return toIdentity(rec);
    });
  },
  update(csid: string, details: IdentityDetails): Promise<ContextualIdentity> {
    return mutate((state) => {
      const rec = state.list.find((r) => r.id === idOf(csid));
      if (!rec) throw invalid(csid);
      if (details.name !== undefined) rec.name = String(details.name);
      if (isColor(details.color)) rec.color = details.color;
      if (isIcon(details.icon)) rec.icon = details.icon;
      return toIdentity(rec);
    });
  },
  remove(csid: string): Promise<ContextualIdentity> {
    return mutate((state) => {
      const idx = state.list.findIndex((r) => r.id === idOf(csid));
      if (idx < 0) throw invalid(csid);
      const [rec] = state.list.splice(idx, 1);
      return toIdentity(rec!);
    });
  },
  move(csids: string | string[], position: number): Promise<void> {
    return mutate((state) => {
      const ids = (Array.isArray(csids) ? csids : [csids]).map(idOf);
      const moving = ids.map((id) => {
        const rec = state.list.find((r) => r.id === id);
        if (!rec) throw invalid(csidOf(id));
        return rec;
      });
      state.list = state.list.filter((r) => !ids.includes(r.id));
      const at = position < 0 || position > state.list.length ? state.list.length : position;
      state.list.splice(at, 0, ...moving);
    });
  },
};
type CiImpl = typeof ciImpl;

type IdentityEvent = (change: { contextualIdentity: ContextualIdentity }) => unknown;
const events = {
  onCreated: makeEvent<IdentityEvent>(),
  onUpdated: makeEvent<IdentityEvent>(),
  onRemoved: makeEvent<IdentityEvent>(),
};
base.storage.onChanged.addListener((changes, area) => {
  const change = changes[IDENT_KEY];
  if (area !== "local" || !change) return;
  const before = ((change.oldValue as IdentityState | undefined) ?? { list: SEED }).list;
  const after = ((change.newValue as IdentityState | undefined) ?? { list: SEED }).list;
  const old = new Map(before.map((r) => [r.id, r]));
  const now = new Map(after.map((r) => [r.id, r]));
  for (const [id, rec] of now) {
    const prev = old.get(id);
    if (!prev) {
      events.onCreated._fire({ contextualIdentity: toIdentity(rec) });
    } else if (prev.name !== rec.name || prev.color !== rec.color || prev.icon !== rec.icon) {
      events.onUpdated._fire({ contextualIdentity: toIdentity(rec) });
    }
  }
  for (const [id, rec] of old) {
    if (!now.has(id)) events.onRemoved._fire({ contextualIdentity: toIdentity(rec) });
  }
});

function inBackground<K extends "create" | "update" | "remove" | "move">(name: K): CiImpl[K] {
  return (async (...args: unknown[]) => {
    if (isBackground) return (ciImpl[name] as (...a: unknown[]) => Promise<unknown>)(...args);
    const remote = bg().__maccCompat.ci[name] as (...a: unknown[]) => Promise<unknown>;
    return clone(await remote(...clone(args)));
  }) as CiImpl[K];
}

export const contextualIdentities = {
  query: ciImpl.query,
  get: ciImpl.get,
  create: inBackground("create"),
  update: inBackground("update"),
  remove: inBackground("remove"),
  move: inBackground("move"),
  async getSupportedColors() {
    return Object.entries(COLORS)
      .filter(([c]) => c !== "toolbar")
      .map(([color, code]) => ({ color, colorCode: code }));
  },
  async getSupportedIcons() {
    return ICONS.map((icon) => ({ icon, iconUrl: base.runtime.getURL(`img/usercontext.svg#${icon}`) }));
  },
  ...events,
};
