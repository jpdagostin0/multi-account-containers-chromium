/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The new tab page's background (settings page): the theme's color, a pixel
// art sky that follows the weather and the time of day, or an image (a file
// the user picked, kept as a data URL, or a web address). Dim darkens it and
// blur softens it, so the page stays readable.

import { base } from "./base";

export const WALLPAPER_KEY = "__macc_wallpaper";

export type WallpaperKind = "none" | "sky" | "image";
/** blur: in CSS pixels. pixelArt: the image dithered into pixel art (on the
 *  GPU), in blocks of pixelSize (per 2000 pixels of the image's short side)
 *  and `colors` shades of each hue. */
export interface Wallpaper {
  kind: WallpaperKind; image: string; dim: number; blur: number;
  pixelArt: boolean; pixelSize: number; colors: number;
}

const DEFAULTS: Wallpaper = { kind: "sky", image: "", dim: 0, blur: 0, pixelArt: false, pixelSize: 8, colors: 4 };

const clampInt = (v: unknown, min: number, max: number, fallback: number) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v as number))) : fallback;

const validImage = (s: string) => /^data:image\//.test(s) || /^https?:\/\//.test(s);

function parse(stored: unknown): Wallpaper {
  const w = (stored ?? {}) as Partial<Wallpaper>;
  return {
    kind: w.kind === "none" || w.kind === "sky" || w.kind === "image" ? w.kind : DEFAULTS.kind,
    image: typeof w.image === "string" && validImage(w.image) ? w.image : "",
    dim: Number.isFinite(w.dim) ? Math.min(0.8, Math.max(0, w.dim!)) : DEFAULTS.dim,
    blur: Number.isFinite(w.blur) ? Math.min(40, Math.max(0, w.blur!)) : DEFAULTS.blur,
    pixelArt: typeof w.pixelArt === "boolean" ? w.pixelArt : DEFAULTS.pixelArt,
    pixelSize: clampInt(w.pixelSize, 2, 20, DEFAULTS.pixelSize),
    colors: clampInt(w.colors, 2, 7, DEFAULTS.colors),
  };
}

export const wallpaper = {
  storageKey: WALLPAPER_KEY,
  async get(): Promise<Wallpaper> {
    const { [WALLPAPER_KEY]: w } = await base.storage.local.get(WALLPAPER_KEY);
    return parse(w);
  },
  async set(patch: Partial<Wallpaper>): Promise<void> {
    if (patch.image && !validImage(patch.image)) throw new Error("Use an http(s) image address.");
    await base.storage.local.set({ [WALLPAPER_KEY]: parse({ ...(await wallpaper.get()), ...patch }) });
  },
};
export type WallpaperApi = typeof wallpaper;
