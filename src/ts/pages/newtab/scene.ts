/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The pixel art scene behind the new tab page: one of pixelfx's weather loops
// at its own 320×180, over a dithered sky (or over nothing, to sit on an
// image), scaled up with crisp pixels by CSS.

import { backdrop, clearFrame, composite, createFrame, createFx, hex, mix, type Fx, type FxModule } from "pixelfx";
import * as blizzard from "pixelfx/fx/weather/blizzard";
import * as clouds from "pixelfx/fx/weather/clouds";
import * as fog from "pixelfx/fx/weather/fog";
import * as godRays from "pixelfx/fx/weather/god-rays";
import * as rain from "pixelfx/fx/weather/rain";
import * as shootingStars from "pixelfx/fx/weather/shooting-stars";
import * as snow from "pixelfx/fx/weather/snow";
import * as storm from "pixelfx/fx/weather/storm";
import type { Effect, Sky } from "../../background/weather";

const W = 320, H = 180;

const MODULES: Record<Effect, FxModule> = {
  rain, storm, snow, blizzard, clouds, fog, "god-rays": godRays, "shooting-stars": shootingStars,
};

// Clouds by day: white tops, a sun where the moon was.
const DAY_OPTIONS: Partial<Record<Effect, Record<string, unknown>>> = {
  clouds: { palette: ["#4f5f78", "#6c7c94", "#8d9bb0", "#adb9ca", "#cbd4e0", "#e2e8f0", "#f2f5f9", "#ffffff"] },
};

// Top and horizon colors.
const SKIES: Record<"day" | "night", Record<Sky, [string, string] | null>> = {
  day: {
    clear: ["#2a64b8", "#8cc4ec"], cloudy: ["#5d6b7e", "#aab4c0"], rain: ["#3c4656", "#7b8696"],
    storm: ["#1f2430", "#4a5262"], snow: ["#7f8ea4", "#cfd7e1"],
  },
  // null: pixelfx's own starry night.
  night: {
    clear: null, cloudy: ["#0d0d18", "#1f2033"], rain: ["#0a0d18", "#1b2236"],
    storm: ["#07070d", "#151525"], snow: ["#0d1020", "#232c45"],
  },
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** A sky in five dithered bands, like pixelfx's backdrop. */
function sky(kind: Sky, isDay: boolean): Uint32Array {
  const colors = SKIES[isDay ? "day" : "night"][kind];
  if (!colors) return backdrop("sky", W, H);
  const [top, low] = colors.map(hex) as [number, number];
  const out = new Uint32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const step = ((y / (H - 1)) * 5 + BAYER[((y & 3) << 2) | (x & 3)]! / 16) | 0;
      out[y * W + x] = mix(top, low, Math.min(1, step / 4));
    }
  return out;
}

export interface SceneSpec {
  effect: Effect | null;
  density: number;
  /** The sky to paint, or null for a transparent scene over an image. */
  sky: Sky | null;
  isDay: boolean;
}

export function createScene(canvas: HTMLCanvasElement) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const frame = createFrame(W, H);
  const img = new ImageData(W, H);
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  let fx: Fx | null = null, bg: Uint32Array | null = null, raf = 0, last = 0;

  const paint = () => {
    clearFrame(frame);
    fx?.draw(frame);
    composite(frame, img.data, bg);
    ctx.putImageData(img, 0, 0);
  };
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const step = 1 / (fx!.meta.fps ?? 30);
    const dt = (now - last) / 1000;
    if (dt < step * 0.9) return;
    last = now;
    fx!.update(Math.min(dt, 0.1));
    paint();
  };

  return {
    canvas,
    spec: null as SceneSpec | null,
    set(spec: SceneSpec | null): void {
      cancelAnimationFrame(raf);
      this.spec = spec;
      canvas.hidden = !spec || (!spec.effect && !spec.sky);
      if (canvas.hidden) return;
      bg = spec!.sky ? sky(spec!.sky, spec!.isDay) : null;
      const e = spec!.effect;
      fx = e ? createFx(MODULES[e], {
        x: MODULES[e].meta.origin[0], y: MODULES[e].meta.origin[1],
        density: spec!.density, ...(spec!.isDay ? DAY_OPTIONS[e] : {}),
      }) : null;
      // Start a little way in, so the first frame already has weather in it.
      fx?.update(2);
      paint();
      if (fx && !still.matches) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    },
  };
}
export type Scene = ReturnType<typeof createScene>;
