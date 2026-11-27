/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The parts of pixelfx (github:patch-gg/pixelfx, plain JavaScript) the new
// tab page uses. Colors are 0xAABBGGRR numbers, ImageData's byte order.

declare module "pixelfx" {
  export interface Frame { w: number; h: number; ox: number; oy: number; color: Uint32Array; light: Uint32Array }
  export interface FxMeta { name: string; size: [number, number]; origin: [number, number]; duration: number; loop?: boolean; fps?: number; options?: Record<string, unknown> }
  export interface FxModule { meta: FxMeta }
  export interface Fx { meta: FxMeta; update(dt: number): void; draw(frame: Frame, layer?: "back" | "front"): void }

  export function createFrame(w: number, h: number, ox?: number, oy?: number): Frame;
  export function clearFrame(f: Frame): Frame;
  export function createFx(mod: FxModule, options?: Record<string, unknown>): Fx;
  export function composite(f: Frame, out: Uint8ClampedArray, bg?: number | Uint32Array | null, lightK?: number): Uint8ClampedArray;
  export function backdrop(kind: "dark" | "ground" | "sky" | "light" | "black", w: number, h: number, groundY?: number): Uint32Array;
  export function hex(color: string): number;
  export function mix(a: number, b: number, t: number): number;
  export function rand(...keys: number[]): number;
}

declare module "pixelfx/fx/weather/*" {
  import type { FxMeta } from "pixelfx";
  export const meta: FxMeta;
}
