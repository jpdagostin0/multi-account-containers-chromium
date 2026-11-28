/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The image wallpaper as pixel art: @kkrll/shaders' WebGPU dithering effect
// (an ordered 4×4 Bayer dither over a pixelated copy, in the image's own
// colors), drawn at the image's size and scaled up with crisp pixels by CSS.
// The library is loaded only once a wallpaper asks for it.

import type { BrowserEffectStack, EffectHandle } from "@kkrll/shaders";

export interface PixelArtSpec { image: string; pixelSize: number; colors: number }

const BAYER_4X4 = 3;

export function createPixelArt(canvas: HTMLCanvasElement) {
  let ready: Promise<{ stack: BrowserEffectStack; dither: EffectHandle }> | null = null;
  let image = "";

  const start = () => ready ??= import("@kkrll/shaders").then(async ({ createEffectStack }) => {
    const stack = await createEffectStack(canvas);
    return { stack, dither: stack.add("dithering", { type: BAYER_4X4, originalColors: 1 }) };
  });

  return {
    canvas,
    /** Resolves false where WebGPU (or the image) isn't available, so the plain image can stand in. */
    async set(spec: PixelArtSpec | null): Promise<boolean> {
      if (!spec) {
        canvas.hidden = true;
        return true;
      }
      try {
        const { stack, dither } = await start();
        dither.setValues({ pxSize: spec.pixelSize, colorSteps: spec.colors });
        if (spec.image !== image) {
          await stack.setImage(spec.image);
          image = spec.image;
        }
        canvas.hidden = false;
        return true;
      } catch (e) {
        console.warn("Pixel art wallpaper unavailable:", e);
        canvas.hidden = true;
        return false;
      }
    },
  };
}
