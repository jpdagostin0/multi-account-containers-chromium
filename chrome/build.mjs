#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Builds the Chromium (Manifest V2) extension into dist/chromium from the
// untouched Firefox sources in ../src plus the compat layer in ./js.
//
//   node chrome/build.mjs [--zip]

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const src = path.join(root, "src");
const out = path.join(root, "dist", "chromium");

const polyfill = path.join(here, "node_modules", "webextension-polyfill", "dist", "browser-polyfill.js");
if (!fs.existsSync(polyfill)) {
  console.error("webextension-polyfill missing: run `npm install` in chrome/ first");
  process.exit(1);
}
if (!fs.existsSync(path.join(src, "_locales", "en", "messages.json"))) {
  console.error("src/_locales is empty: run `git submodule update --init`");
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });

// Locales: Chromium rejects stray files in _locales.
const locales = path.join(out, "_locales");
const english = JSON.parse(fs.readFileSync(path.join(locales, "en", "messages.json"), "utf8"));
// Chromium also only accepts [A-Za-z0-9_] in message names (compat.js maps
// the lookups the same way).
for (const entry of fs.readdirSync(locales, { withFileTypes: true })) {
  const file = path.join(locales, entry.name, "messages.json");
  if (!entry.isDirectory() || !fs.existsSync(file)) {
    fs.rmSync(path.join(locales, entry.name), { recursive: true, force: true });
    continue;
  }
  const messages = JSON.parse(fs.readFileSync(file, "utf8"));
  const fixed = Object.fromEntries(Object.entries(messages).map(([k, v]) => {
    // Some translations use $placeholders$ without declaring them; Firefox
    // tolerates that, Chromium refuses to load. Borrow English's declaration.
    if (!v.placeholders && /\$[A-Za-z0-9_]+\$/.test(v.message || "") && english[k]) {
      v = { ...v, placeholders: english[k].placeholders };
    }
    return [k.replace(/[^A-Za-z0-9_]/g, "_"), v];
  }));
  fs.writeFileSync(file, JSON.stringify(fixed, null, 2));
}

// Compat layer.
const jsOut = path.join(out, "js", "chrome");
fs.mkdirSync(jsOut, { recursive: true });
fs.copyFileSync(polyfill, path.join(jsOut, "browser-polyfill.js"));
for (const f of fs.readdirSync(path.join(here, "js"))) {
  fs.copyFileSync(path.join(here, "js", f), path.join(jsOut, f));
}
fs.cpSync(path.join(here, "icons"), path.join(out, "icons"), { recursive: true });

// Icon tinting: see chrome/css/chromium.css. `context-fill` is Firefox-only
// too; bake in a dark fill (the dark theme already inverts these icons).
fs.appendFileSync(path.join(out, "css", "popup.css"), fs.readFileSync(path.join(here, "css", "chromium.css")));
for (const f of fs.readdirSync(path.join(out, "img"), { recursive: true })) {
  if (!String(f).endsWith(".svg")) continue;
  const file = path.join(out, "img", String(f));
  const svg = fs.readFileSync(file, "utf8");
  const fixed = svg
    .replace(/\s*fill-opacity="context-fill-opacity"/g, "")
    .replace(/\s*stroke-opacity="context-stroke-opacity"/g, "")
    .replace(/context-(?:fill|stroke) light-dark\(\s*([^,]+),[^)]*\)/g, "$1")
    .replace(/context-(?:fill|stroke) (#[0-9a-fA-F]+|[a-z]+)/g, "$1")
    .replace(/context-(?:fill|stroke)/g, "#0c0c0d");
  if (fixed !== svg) fs.writeFileSync(file, fixed);
}

// Every extension page gets the polyfill + compat shim before its own scripts;
// the background page also gets the isolation engine.
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "_locales" ? [] : walk(p);
    return p.endsWith(".html") ? [p] : [];
  });
}
for (const file of walk(out)) {
  let html = fs.readFileSync(file, "utf8");
  const rel = path.relative(path.dirname(file), jsOut).split(path.sep).join("/");
  const scripts = ["browser-polyfill.js", "compat.js"];
  if (file === path.join(out, "js", "background", "index.html")) scripts.push("isolation.js");
  const tags = scripts.map((s) => `<script src="${rel}/${s}"></script>`).join("\n    ");
  const at = html.search(/<script\b/i);
  if (at < 0) continue;
  html = `${html.slice(0, at)}${tags}\n    ${html.slice(at)}`;
  fs.writeFileSync(file, html);
}

// Manifest.
const manifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));
const icons = { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" };
manifest.name = "Multi-Account Containers";
manifest.homepage_url = "https://github.com/jpdagostin0/multi-account-containers-chromium#readme";
manifest.icons = icons;
manifest.minimum_chrome_version = "120";
delete manifest.browser_specific_settings;
manifest.permissions = [
  ...manifest.permissions.filter((p) => !["contextualIdentities", "idle"].includes(p)),
  "webNavigation",
  "browsingData",
];
manifest.optional_permissions = [];
manifest.background = { page: manifest.background.page, persistent: true };
manifest.browser_action = {
  default_icon: icons,
  default_title: "Multi-Account Containers",
  default_popup: manifest.browser_action.default_popup,
};
// Chromium allows a browser_action or a page_action, not both.
delete manifest.page_action;
manifest.options_ui = { page: manifest.options_ui.page, open_in_tab: true };
manifest.content_scripts = [
  {
    matches: ["<all_urls>"],
    js: ["js/chrome/content-isolation.js"],
    run_at: "document_start",
    all_frames: true,
    match_about_blank: true,
  },
  ...manifest.content_scripts.map((cs) => ({ ...cs, js: ["js/chrome/browser-polyfill.js", ...cs.js] })),
];
manifest.web_accessible_resources = [
  ...manifest.web_accessible_resources.map((r) => r.replace(/^\//, "")),
  "confirm-page.html",
];
// Chromium caps suggested shortcuts at four; keep the panel shortcut and
// let users bind the rest at chrome://extensions/shortcuts.
for (const [name, cmd] of Object.entries(manifest.commands)) {
  if (name !== "_execute_browser_action") delete cmd.suggested_key;
}
fs.writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`built ${path.relative(root, out)} (v${manifest.version})`);

if (process.argv.includes("--zip")) {
  const zip = path.join(root, "dist", `multi-account-containers-chromium-${manifest.version}.zip`);
  fs.rmSync(zip, { force: true });
  execFileSync("zip", ["-qr", zip, "."], { cwd: out });
  console.log(`packed ${path.relative(root, zip)}`);
}
