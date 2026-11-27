/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Shared state of the isolation engine.

import { IDENT_KEY, SEED, type IdentityRec, type IdentityState } from "../../lib/constants";

export type ContainerListener = (tabId: number, n: number | null, before: number) => void;

/** tabId -> container number (absent = default) */
export const tabs = new Map<number, number>();
/** requestId -> container number, for navigations that switch container */
export const requestOverride = new Map<string, number>();
/** tabId -> container number the in-flight top-level navigation will commit to */
export const pendingCommit = new Map<number, number>();
/** storage.local mirror, for synchronous lookups inside blocking listeners */
export const mirror: Record<string, any> = {};
/** tabId -> when we last reloaded it to fix its container */
export const recentReloads = new Map<number, number>();
/** tab ids that existed when the extension started (session restore) */
export const startup = { tabs: new Set<number>(), at: Date.now() };
export const listeners = { tabContainerChanged: [] as ContainerListener[] };
/** set by other modules */
export const hooks = { borderColorForTab: (_tabId: number): string | null => null };
/** storage loaded and tabs restored */
export const status = { ready: false };

export const identityList = (): readonly IdentityRec[] =>
  (mirror[IDENT_KEY] as IdentityState | undefined)?.list ?? SEED;
export const identity = (n: number) => identityList().find((r) => r.id === n);
export const identityExists = (n: number) => n === 0 || !!identity(n);
export const containerOf = (tabId: number) => tabs.get(tabId) || 0;
