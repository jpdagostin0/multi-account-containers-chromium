/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Colors of the extension's pages and toolbar panel: the system's light/dark,
// always light, always dark, or custom colors.

import type { ColorMode, ColorSettings, ThemeApi } from "../../background/theme";
import { card, el } from "./dom";

const MODES: [ColorMode, string][] = [["system", "System"], ["light", "Light"], ["dark", "Dark"], ["custom", "Custom"]];
const SWATCHES = [["background", "Background"], ["surface", "Surface"], ["text", "Text"]] as const;

export function colorsSection(theme: ThemeApi): HTMLElement {
  let s: ColorSettings = theme.get();
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const save = () => { clearTimeout(saveTimer); theme.set(s); };
  // Color pickers fire while dragging.
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => theme.set(s), 120); };

  const modes = el("div", { className: "segmented", role: "group" });
  const buttons = MODES.map(([mode, label]) => {
    const b = el("button", { type: "button", textContent: label });
    b.addEventListener("click", () => { s = { ...s, mode }; render(); save(); });
    modes.append(b);
    return [mode, b] as const;
  });

  const preset = el("select", {});
  preset.append(el("option", { value: "", textContent: "Start from a preset…" }),
    ...Object.keys(theme.presets).map((n) => el("option", { value: n, textContent: n })));
  preset.addEventListener("change", () => {
    const p = theme.presets[preset.value];
    if (p) { s = { ...s, custom: { ...p } }; render(); save(); }
    preset.value = "";
  });

  const pickers = SWATCHES.map(([key, label]) => {
    const input = el("input", { type: "color" });
    const code = el("code", {});
    input.addEventListener("input", () => { s = { ...s, custom: { ...s.custom, [key]: input.value } }; render(); saveSoon(); });
    return { key, input, code, node: el("label", { className: "color" }, input, el("span", { className: "row-text" }, el("span", { className: "row-label", textContent: label }), code)) };
  });
  const preview = el("div", { className: "preview" }, el("span", { textContent: "Tile" }), el("span", { textContent: "Another tile" }));
  const custom = el("div", {}, preset, el("div", { className: "colors" }, ...pickers.map((p) => p.node)), preview);

  function render(): void {
    for (const [mode, b] of buttons) b.setAttribute("aria-pressed", String(s.mode === mode));
    custom.hidden = s.mode !== "custom";
    for (const p of pickers) {
      p.input.value = s.custom[p.key];
      p.code.textContent = s.custom[p.key];
    }
    preview.style.setProperty("--p-bg", s.custom.background);
    preview.style.setProperty("--p-surface", s.custom.surface);
    preview.style.setProperty("--p-fg", s.custom.text);
  }
  render();

  return card("Colors",
    "Colors of the new tab, history and settings pages and the toolbar panel. System follows your light or dark mode.",
    modes, custom);
}
