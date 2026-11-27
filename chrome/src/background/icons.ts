/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Site icon fetching and drawing (background page), shared by highlight.ts
// (container-marked tab icons) and history.ts (saved icons).
//
// Decoding uses createImageBitmap, which decodes off the main thread and
// scales during decode. SVG icons, which createImageBitmap can't take from a
// Blob, go through an <img>. Encoding uses the synchronous
// canvas.toDataURL: a 32px PNG takes well under a millisecond, while the
// async OffscreenCanvas.convertToBlob encodes in an idle task, which a
// frameless background page only gets when its ~1 s timeout fires.

const SIZE = 32;

/** Fetch an icon without cookies, from the extension (no page CORS limits). */
export async function fetchIcon(href: string | null | undefined): Promise<Blob | null> {
  if (!href || !/^(https?|data):/.test(href)) return null;
  try {
    const res = await fetch(href, { credentials: "omit", cache: "default", signal: AbortSignal.timeout(5000) });
    const blob = res.ok ? await res.blob() : null;
    return blob && blob.size ? blob : null;
  } catch {
    return null;
  }
}

function viaImg(blob: Blob): Promise<HTMLImageElement | null> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img, () => null).finally(() => URL.revokeObjectURL(url));
}

/** Decode an icon, scaled to size x size. */
async function decode(blob: Blob | null, size: number): Promise<CanvasImageSource | null> {
  if (!blob) return null;
  if (!blob.type.includes("svg")) {
    try {
      return await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: "high" });
    } catch { /* not a raster type Chromium can decode from a Blob */ }
  }
  return viaImg(blob);
}

let canvas: HTMLCanvasElement | null = null;
function render(draw: (ctx: CanvasRenderingContext2D) => void): string {
  canvas ??= Object.assign(document.createElement("canvas"), { width: SIZE, height: SIZE });
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, SIZE, SIZE);
  draw(ctx);
  return canvas.toDataURL("image/png");
}

const close = (img: CanvasImageSource | null) => { if (img instanceof ImageBitmap) img.close(); };

/**
 * The site's icon with a line in the container's color down its left edge
 * (2 CSS px at the usual 16px tab icon size), the icon shrunk beside it.
 */
export async function markedIconFrom(blob: Blob | null, color: string): Promise<string> {
  const BAR = 4;
  const GAP = 2;
  const size = SIZE - BAR - GAP;
  const img = await decode(blob, size);
  try {
    return render((ctx) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(0, 0, BAR, SIZE, BAR / 2);
      ctx.fill();
      if (img) ctx.drawImage(img, BAR + GAP, (SIZE - size) / 2, size, size);
    });
  } finally {
    close(img);
  }
}

/** Unmarked 32px copy of a site icon (new tab and history pages). */
export async function plainIcon(hrefOrBlob: string | Blob | null): Promise<string | null> {
  const blob = typeof hrefOrBlob === "string" ? await fetchIcon(hrefOrBlob) : hrefOrBlob;
  const img = await decode(blob, SIZE);
  if (!img) return null;
  try {
    return render((ctx) => ctx.drawImage(img, 0, 0, SIZE, SIZE));
  } finally {
    close(img);
  }
}
