/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The new tab page's background: the theme's color, a pixel art sky that
// follows the weather, or an image (a file or a web address).

import type { Wallpaper, WallpaperApi, WallpaperKind } from "../../background/wallpaper";
import { card, el, savedNote } from "./dom";

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

  const dim = el("input", { type: "range", min: "0", max: "80", step: "5" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  dim.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => save({ dim: Number(dim.value) / 100 }), 120); });
  dim.addEventListener("change", () => { clearTimeout(timer); save({ dim: Number(dim.value) / 100 }); });
  const dimRow = el("label", { className: "setting stacked" },
    el("span", { className: "setting-text" }, el("span", { className: "setting-label", textContent: "Dim" }), el("span", { className: "setting-desc", textContent: "Darken the background so the page reads well over it." })),
    dim);

  function render(): void {
    if (!w) return;
    for (const [kind, b] of kindButtons) b.setAttribute("aria-pressed", String(w.kind === kind));
    image.hidden = w.kind !== "image";
    dimRow.hidden = w.kind === "none";
    preview.style.backgroundImage = w.image ? `url(${JSON.stringify(w.image)})` : "";
    preview.classList.toggle("empty", !w.image);
    if (w.image && !w.image.startsWith("data:")) url.value = w.image;
    dim.value = String(Math.round(w.dim * 100));
  }
  wallpaper.get().then((v) => { w = v; render(); });

  return card("Wallpaper",
    "Behind the new tab page. The pixel sky follows the weather and the time of day; weather effects play over images too.",
    kinds, image, dimRow, el("p", { className: "actions" }, note.node));
}
