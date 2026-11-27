/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Optional colored frame around container pages (see background/highlight).

let frame: HTMLElement | null = null;
let keeper: MutationObserver | null = null;

function create(): HTMLElement {
  const el = document.createElement("macc-container-frame");
  const root = el.attachShadow({ mode: "closed" });
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;"
    + "box-sizing:border-box;border:3px solid var(--c);border-radius:0;";
  root.append(box);
  el.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  // Pages that rebuild <html> or <body> shouldn't be able to drop it.
  const k = new MutationObserver(() => {
    if (!frame) return;
    if (document.documentElement) k.observe(document.documentElement, { childList: true });
    if (!frame.isConnected) (document.documentElement || document).appendChild(frame);
  });
  k.observe(document, { childList: true });
  if (document.documentElement) k.observe(document.documentElement, { childList: true });
  keeper = k;
  return el;
}

export function setBorder(color: string | null): void {
  if (!color) {
    keeper?.disconnect();
    frame?.remove();
    frame = keeper = null;
    return;
  }
  frame ??= create();
  frame.style.setProperty("--c", color);
  frame.dataset.color = color;
  if (!frame.isConnected) (document.documentElement || document).appendChild(frame);
}
