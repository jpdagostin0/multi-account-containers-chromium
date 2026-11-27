/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The settings sections, shared by the settings page and the new tab page's
// settings drawer.

import type { BackgroundWindow } from "../../lib/globals";
import { colorsSection } from "./colors";
import { highlightingSection } from "./highlighting";
import { searchSection } from "./search";
import { onboardingSection, shortcutsSection, tabsSection } from "./tabs";
import { wallpaperSection } from "./wallpaper";
import { weatherSection } from "./weather";

export const settingsSections = (page: BackgroundWindow): HTMLElement[] => [
  searchSection(page.__maccSearch),
  colorsSection(page.__maccTheme),
  weatherSection(page.__maccWeather),
  wallpaperSection(page.__maccWallpaper),
  highlightingSection(page.__maccHighlight),
  tabsSection(),
  shortcutsSection(),
  onboardingSection(),
];
