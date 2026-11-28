/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The settings drawer, at the left under the container tabs: every setting.

import type { BackgroundWindow } from "../../lib/globals";
import { settingsSections } from "../settings/sections";
import { setUpDrawer } from "./drawer";

/** Returns a function that opens the drawer, at a section (by id) if given. */
export function setUpSettingsDrawer(page: BackgroundWindow): (section?: string) => void {
  const drawer = document.getElementById("settings-drawer")!;
  const body = drawer.querySelector(".drawer-body")!;
  let built = false;
  const { setOpen } = setUpDrawer({
    drawer, toggle: document.getElementById("settings-toggle")!, side: "start", openClass: "settings-open",
    onOpen: () => {
      if (!built) body.append(...settingsSections(page));
      built = true;
    },
    focus: () => drawer.querySelector<HTMLElement>(".close"),
  });
  return (section) => {
    setOpen(true);
    if (section) body.querySelector(`#${CSS.escape(section)}`)?.scrollIntoView({ block: "start" });
  };
}
