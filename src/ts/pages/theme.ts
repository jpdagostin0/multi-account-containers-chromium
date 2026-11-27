/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// First script in every extension page's <head>: applies the color palette
// from the settings page, which the background page leaves in localStorage
// (background/theme), so pages paint in those colors from the start.
// Stylesheets map the --macc-* variables under :root[data-browser-theme].
// Without a palette ("follow the system"), pages use their own light/dark
// colors.

const KEY = "maccPalette";

interface Palette { scheme: "light" | "dark"; vars: Record<string, string> }

function palette(): Palette | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null") as Palette | null;
  } catch {
    return null;
  }
}

function apply(): void {
  const root = document.documentElement;
  const p = palette();
  let style = document.getElementById("macc-browser-theme");
  if (!p) {
    style?.remove();
    delete root.dataset.browserTheme;
    root.style.colorScheme = "";
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = "macc-browser-theme";
    (document.head || root).append(style);
  }
  style.textContent = `:root { ${Object.entries(p.vars).map(([k, v]) => `${k}: ${v};`).join(" ")} }`;
  root.dataset.browserTheme = p.scheme;
  root.style.colorScheme = p.scheme;
  // The popup picks its light/dark variables with data-theme.
  if (root.hasAttribute("data-theme")) root.dataset.theme = p.scheme;
}

apply();
addEventListener("storage", (e) => { if (e.key === KEY || e.key === null) apply(); });
