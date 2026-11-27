/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Page colors from three base colors (settings page), as the CSS variables the
// extension pages map under :root[data-browser-theme].

export interface Colors { background: string; surface: string; text: string }
export interface Palette { scheme: "light" | "dark"; vars: Record<string, string> }

type Rgb = [number, number, number];

export const LIGHT: Colors = { background: "#f9f9fb", surface: "#ffffff", text: "#15141a" };
export const DARK: Colors = { background: "#1c1b22", surface: "#2b2a33", text: "#fbfbfe" };

/** Ready-made custom colors for the settings page. */
export const PRESETS: Record<string, Colors> = {
  "Catppuccin Mocha": { background: "#1e1e2e", surface: "#11111b", text: "#cdd6f4" },
  "Catppuccin Latte": { background: "#eff1f5", surface: "#e6e9ef", text: "#4c4f69" },
  "Nord": { background: "#2e3440", surface: "#3b4252", text: "#eceff4" },
  "Gruvbox Dark": { background: "#282828", surface: "#3c3836", text: "#ebdbb2" },
  "Solarized Light": { background: "#fdf6e3", surface: "#eee8d5", text: "#586e75" },
  "Tokyo Night": { background: "#1a1b26", surface: "#16161e", text: "#c0caf5" },
};

export const isHex = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
const rgbOf = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const css = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`;

/** Relative luminance (WCAG). */
function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function paletteOf(colors: Colors): Palette | null {
  if (![colors.background, colors.surface, colors.text].every(isHex)) return null;
  const page = rgbOf(colors.background);
  const surface = rgbOf(colors.surface);
  const fg = rgbOf(colors.text);
  const mix = (pct: number, over: string) => `color-mix(in srgb, ${css(fg)} ${pct}%, ${over})`;
  return {
    scheme: luminance(page) < 0.25 ? "dark" : "light",
    vars: {
      "--macc-bg": css(page),
      "--macc-toolbar": css(page),
      "--macc-frame": css(surface),
      "--macc-fg": css(fg),
      "--macc-muted": mix(65, css(page)),
      "--macc-tile": css(surface),
      "--macc-field": css(surface),
      "--macc-hover": mix(10, "transparent"),
      "--macc-active": mix(16, "transparent"),
      "--macc-tile-hover": mix(10, css(surface)),
      "--macc-border": mix(16, css(page)),
      "--macc-border-strong": mix(40, css(page)),
    },
  };
}
