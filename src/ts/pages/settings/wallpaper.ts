/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The new tab page's background: the theme's color, a pixel art sky that
// follows the weather, or an image (a file or a web address).

import type { Wallpaper, WallpaperApi, WallpaperKind } from "../../background/wallpaper";
import { card, el, savedNote, toggle } from "./dom";

const KINDS: [WallpaperKind, string][] = [["none", "None"], ["sky", "Pixel sky"], ["image", "Image"]];
const MAX_SIDE = 2560;

/** A picked file as a data URL, scaled down to at most MAX_SIDE (GIFs as they are, so they keep moving). */
async function readImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");
  if (file.type !== "image/gif") {
    const bitmap = await createImageBitmap(file);
    const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = el("canvas", { width: Math.round(bitmap.width * k), height: Math.round(bitmap.height * k) });
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.9);
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function wallpaperSection(wallpaper: WallpaperApi): HTMLElement {
  let w: Wallpaper | null = null;
  const note = savedNote();
  const save = async (patch: Partial<Wallpaper>) => {
    try {
      await wallpaper.set(patch);
      w = await wallpaper.get();
      render();
      note.ok();
    } catch (e) {
      note.error((e as Error).message);
    }
  };

  const kinds = el("div", { className: "segmented", role: "group" });
  const kindButtons = KINDS.map(([kind, label]) => {
    const b = el("button", { type: "button", textContent: label });
    b.addEventListener("click", () => save({ kind }));
    kinds.append(b);
    return [kind, b] as const;
  });

  const preview = el("div", { className: "wallpaper-preview" });
  const file = el("input", { type: "file", accept: "image/*", hidden: true });
  const pick = el("button", { type: "button", textContent: "Choose a file…" });
  pick.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    try {
      await save({ kind: "image", image: await readImage(f) });
    } catch (e) {
      note.error((e as Error).message);
    }
  });
  const url = el("input", { type: "text", placeholder: "https://example.com/picture.jpg", spellcheck: false });
  const useUrl = el("button", { type: "button", textContent: "Use" });
  const saveUrl = () => save({ kind: "image", image: url.value.trim() });
  useUrl.addEventListener("click", saveUrl);
  url.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveUrl(); } });
  const image = el("div", { className: "wallpaper-image" }, preview,
    el("div", { className: "wallpaper-source" }, el("p", { className: "actions" }, pick, file), el("div", { className: "place-search" }, url, useUrl)));

  /** A labelled slider, saved as you drag. */
  function slider(label: string, desc: string, max: number, step: number, patch: (v: number) => Partial<Wallpaper>) {
    const input = el("input", { type: "range", min: "0", max: String(max), step: String(step) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => save(patch(Number(input.value))), 120); });
    input.addEventListener("change", () => { clearTimeout(timer); save(patch(Number(input.value))); });
    const node = el("label", { className: "setting stacked" },
      el("span", { className: "setting-text" }, el("span", { className: "setting-label", textContent: label }), el("span", { className: "setting-desc", textContent: desc })),
      input);
    return { node, input };
  }
  const dim = slider("Dim", "Darken the background so the page reads well over it.", 80, 5, (v) => ({ dim: v / 100 }));
  const blur = slider("Blur", "Soften the background.", 40, 1, (v) => ({ blur: v }));
  const pixelArt = toggle("Pixel art", "Dither the image into chunky pixels and a few shades of each color (needs WebGPU).", (on) => save({ pixelArt: on }));
  const pixelSize = slider("Pixel size", "How big the pixels are.", 20, 1, (v) => ({ pixelSize: v }));
  const colors = slider("Shades", "How many shades of each color are left.", 7, 1, (v) => ({ colors: v }));
  pixelSize.input.min = colors.input.min = "2";

  function render(): void {
    if (!w) return;
    for (const [kind, b] of kindButtons) b.setAttribute("aria-pressed", String(w.kind === kind));
    image.hidden = w.kind !== "image";
    dim.node.hidden = blur.node.hidden = w.kind === "none";
    preview.style.backgroundImage = w.image ? `url(${JSON.stringify(w.image)})` : "";
    preview.classList.toggle("empty", !w.image);
    if (w.image && !w.image.startsWith("data:")) url.value = w.image;
    dim.input.value = String(Math.round(w.dim * 100));
    blur.input.value = String(w.blur);
    pixelArt.node.hidden = w.kind !== "image";
    pixelSize.node.hidden = colors.node.hidden = w.kind !== "image" || !w.pixelArt;
    pixelArt.input.checked = w.pixelArt;
    pixelSize.input.value = String(w.pixelSize);
    colors.input.value = String(w.colors);
  }
  wallpaper.get().then((v) => { w = v; render(); });

  return card("Wallpaper",
    "Behind the new tab page. The pixel sky follows the weather and the time of day; weather effects play over images too.",
    kinds, image, pixelArt.node, pixelSize.node, colors.node, dim.node, blur.node, el("p", { className: "actions" }, note.node));
}
