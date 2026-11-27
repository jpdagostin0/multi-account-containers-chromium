/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The settings page (replaces upstream's options page).

import { backgroundPage } from "../background";
import { colorsSection } from "./colors";
import { highlightingSection } from "./highlighting";
import { searchSection } from "./search";
import { onboardingSection, shortcutsSection, tabsSection } from "./tabs";

const page = backgroundPage();
document.getElementById("sections")!.append(
  searchSection(page.__maccSearch),
  colorsSection(page.__maccTheme),
  highlightingSection(page.__maccHighlight),
  tabsSection(),
  shortcutsSection(),
  onboardingSection(),
);
