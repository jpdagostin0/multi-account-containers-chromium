/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// A Chrome theme's colors (manifest "theme.colors", RGB arrays) turned into
// the CSS variables the extension pages use.

export type Rgb = [number, number, number];
export interface ThemeColors { [name: string]: number[] | undefined }
export interface Palette { scheme: "light" | "dark"; vars: Record<string, string> }

const rgb = (c: Rgb) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const pick = (colors: ThemeColors, ...names: string[]): Rgb | null => {
  for (const n of names) {
    const c = colors[n];
    if (Array.isArray(c) && c.length >= 3) return [c[0]!, c[1]!, c[2]!];
  }
  return null;
};
const same = (a: Rgb, b: Rgb) => a.every((v, i) => v === b[i]);

/** Relative luminance (WCAG). */
function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** null when the theme only has images (or nothing we can use). */
export function paletteOf(colors: ThemeColors | undefined): Palette | null {
  if (!colors) return null;
  const toolbar = pick(colors, "toolbar", "frame");
  const page = pick(colors, "ntp_background") ?? toolbar;
  if (!toolbar || !page) return null;
  const frame = pick(colors, "frame") ?? toolbar;
  const scheme = luminance(page) < 0.25 ? "dark" : "light";
  const fg = pick(colors, "ntp_text", "tab_text", "bookmark_text", "toolbar_button_icon")
    ?? (scheme === "dark" ? [251, 251, 254] : [21, 20, 26]);
  const muted = pick(colors, "tab_background_text");
  const field = pick(colors, "omnibox_background") ?? frame;
  const mix = (pct: number, over: string) => `color-mix(in srgb, ${rgb(fg)} ${pct}%, ${over})`;
  // Tiles and cards: the frame color when it differs from the page, else a
  // tint of the page.
  const tile = same(frame, page) ? mix(6, rgb(page)) : rgb(frame);
  return {
    scheme,
    vars: {
      "--macc-bg": rgb(page),
      "--macc-toolbar": rgb(toolbar),
      "--macc-frame": rgb(frame),
      "--macc-fg": rgb(fg),
      "--macc-muted": muted ? rgb(muted) : mix(65, rgb(page)),
      "--macc-tile": tile,
      "--macc-field": rgb(field),
      "--macc-hover": mix(10, "transparent"),
      "--macc-active": mix(16, "transparent"),
      "--macc-tile-hover": mix(10, tile),
      "--macc-border": mix(16, rgb(page)),
      "--macc-border-strong": mix(40, rgb(page)),
    },
  };
}
