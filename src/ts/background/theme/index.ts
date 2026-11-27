/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Match the extension pages to the browser's theme. The active theme comes
// from chrome.management; its colors from the native helper, which reads the
// theme's manifest from the profile. The palette goes to localStorage, which
// every extension page shares and can read synchronously before it paints
// (ts/pages/theme.ts).

import { base } from "../base";
import { HOST } from "../proxy/state";
import { paletteOf, type Palette, type ThemeColors } from "./palette";

export const THEME_KEY = "maccBrowserTheme";
/** The options page's Light / Dark / Auto choice, mirrored for the pages. */
const CHOICE_KEY = "maccThemeChoice";

interface ThemeReply { type?: string; id?: number; theme?: { colors?: ThemeColors } | null }

/** One request on a fresh helper connection; null if the helper is missing. */
function askHelper(msg: Record<string, unknown>): Promise<ThemeReply | null> {
  const { promise, resolve } = Promise.withResolvers<ThemeReply | null>();
  let port: chrome.runtime.Port;
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch {
    return Promise.resolve(null);
  }
  const done = (r: ThemeReply | null) => { clearTimeout(timer); port.disconnect(); resolve(r); };
  const timer = setTimeout(() => done(null), 5000);
  port.onMessage.addListener((m: ThemeReply) => {
    if (m.type === "hello") port.postMessage({ ...msg, id: 1 });
    else if (m.id === 1) done(m);
  });
  port.onDisconnect.addListener(() => { void chrome.runtime.lastError; clearTimeout(timer); resolve(null); });
  return promise;
}

let current: { id: string | null; palette: Palette | null } = { id: null, palette: null };

function store(palette: Palette | null): void {
  if (palette) localStorage.setItem(THEME_KEY, JSON.stringify(palette));
  else localStorage.removeItem(THEME_KEY);
}

let retry: ReturnType<typeof setTimeout> | undefined;

/** Look up the active theme; retries a few times for freshly installed ones. */
async function refresh(attempt = 0): Promise<void> {
  clearTimeout(retry);
  const theme = (await base.management.getAll()).find((e) => e.type === "theme" && e.enabled);
  if (!theme) {
    current = { id: null, palette: null };
    store(null);
    return;
  }
  const reply = await askHelper({ type: "theme", extension: theme.id, version: theme.version });
  const palette = paletteOf(reply?.theme?.colors);
  current = { id: theme.id, palette };
  store(palette);
  // The browser writes a new unpacked theme's path to Preferences lazily.
  if (reply && !reply.theme && attempt < 3) retry = setTimeout(() => refresh(attempt + 1), 5000 * (attempt + 1));
}

const onChange = (info: chrome.management.ExtensionInfo) => {
  if (info.type === "theme" || info.id === current.id) refresh();
};
chrome.management.onEnabled.addListener(onChange);
chrome.management.onDisabled.addListener(onChange);
chrome.management.onInstalled.addListener(onChange);
chrome.management.onUninstalled.addListener((id) => { if (id === current.id) refresh(); });
refresh();

const mirrorChoice = (choice: unknown) => localStorage.setItem(CHOICE_KEY, typeof choice === "string" ? choice : "auto");
base.storage.local.get("currentTheme").then(({ currentTheme }) => mirrorChoice(currentTheme));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.currentTheme) mirrorChoice(changes.currentTheme.newValue);
});

export const theme = {
  refresh: () => refresh(),
  status: () => ({ ...current }),
};
export type ThemeApi = typeof theme;
