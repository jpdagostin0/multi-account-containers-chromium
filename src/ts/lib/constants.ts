/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Constants and helpers shared by every bundle (pages, background, content).

export const DEFAULT = "firefox-default";
export const CPREFIX = "firefox-container-";
export const IDENT_KEY = "__macc_identities";
export const SETTINGS_KEY = "__macc_settings";

/** Cookie / storage names that belong to container n start with `MACC<n>~`. */
export const ANY_PREFIX = /^MACC(\d+)~/;
export const prefixFor = (n: number): string => `MACC${n}~`;

export const COLORS = {
  blue: "#37adff",
  turquoise: "#00c79a",
  green: "#51cd00",
  yellow: "#ffcb00",
  orange: "#ff9f00",
  red: "#ff613d",
  pink: "#ff4bda",
  purple: "#af51f5",
  toolbar: "#7c7c7d",
} as const;
export type ColorName = keyof typeof COLORS;
export const colorCode = (c: string): string => COLORS[c as ColorName] ?? COLORS.blue;
export const isColor = (c: unknown): c is ColorName => typeof c === "string" && c in COLORS;

export const ICONS = [
  "fingerprint", "briefcase", "dollar", "cart", "vacation", "gift", "food",
  "fruit", "pet", "tree", "chill", "circle", "fence",
] as const;
export const isIcon = (i: unknown): i is (typeof ICONS)[number] =>
  typeof i === "string" && (ICONS as readonly string[]).includes(i);

/** One container as stored in storage.local[IDENT_KEY]. */
export interface IdentityRec {
  id: number;
  name: string;
  color: string;
  icon: string;
}
export interface IdentityState {
  nextId: number;
  list: IdentityRec[];
}

// Firefox ships these four containers out of the box.
export const SEED: readonly IdentityRec[] = [
  { id: 1, name: "Personal", color: "blue", icon: "fingerprint" },
  { id: 2, name: "Work", color: "orange", icon: "briefcase" },
  { id: 3, name: "Banking", color: "green", icon: "dollar" },
  { id: 4, name: "Shopping", color: "pink", icon: "cart" },
];

export const idOf = (csid: unknown): number =>
  typeof csid === "string" && csid.startsWith(CPREFIX)
    ? Number(csid.slice(CPREFIX.length)) || 0 : 0;
export const csidOf = (id: number | null | undefined): string => (id ? CPREFIX + id : DEFAULT);

/** Swallow chrome.runtime.lastError in fire-and-forget callbacks. */
export const lastError = (): void => void chrome.runtime.lastError;

/** Runs fn when the event loop is idle (at most `timeout` ms later). */
export const whenIdle = (fn: () => void, timeout = 1000): number =>
  requestIdleCallback(() => fn(), { timeout });
