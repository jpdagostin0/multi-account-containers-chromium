/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Page colors (settings page): follow the system, light, dark, or custom
// colors. The palette goes to localStorage, which every extension page shares
// and reads synchronously before it paints (ts/pages/theme.ts).

import { base } from "../base";
import { DARK, LIGHT, PRESETS, paletteOf, type Colors } from "./palette";

export const PALETTE_KEY = "maccPalette";
export const COLORS_KEY = "__macc_colors";

export type ColorMode = "system" | "light" | "dark" | "custom";
export interface ColorSettings { mode: ColorMode; custom: Colors }

const DEFAULTS: ColorSettings = { mode: "system", custom: PRESETS["Catppuccin Mocha"]! };

let current: ColorSettings = DEFAULTS;

function apply(s: ColorSettings): void {
  const colors = s.mode === "light" ? LIGHT : s.mode === "dark" ? DARK : s.mode === "custom" ? s.custom : null;
  const palette = colors ? paletteOf(colors) : null;
  if (palette) localStorage.setItem(PALETTE_KEY, JSON.stringify(palette));
  else localStorage.removeItem(PALETTE_KEY);
  // The toolbar panel picks its own light/dark set from currentTheme.
  const popup = s.mode === "light" || s.mode === "dark" ? s.mode : "auto";
  base.storage.local.get("currentTheme").then(({ currentTheme }) => {
    if (currentTheme !== popup) base.storage.local.set({ currentTheme: popup });
  });
}

function parse(stored: unknown): ColorSettings {
  const s = (stored ?? {}) as Partial<ColorSettings>;
  return {
    mode: ["system", "light", "dark", "custom"].includes(s.mode as string) ? s.mode! : DEFAULTS.mode,
    custom: { ...DEFAULTS.custom, ...(s.custom ?? {}) },
  };
}

base.storage.local.get(COLORS_KEY).then((all) => {
  current = parse(all[COLORS_KEY]);
  apply(current);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[COLORS_KEY]) return;
  current = parse(changes[COLORS_KEY].newValue);
  apply(current);
});

export const theme = {
  get: (): ColorSettings => ({ ...current, custom: { ...current.custom } }),
  set: (s: ColorSettings) => base.storage.local.set({ [COLORS_KEY]: parse(s) }),
  presets: PRESETS,
};
export type ThemeApi = typeof theme;
