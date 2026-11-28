/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Highlighting settings (storage.local `__macc_settings`, settings drawer).

import { SETTINGS_KEY } from "../../lib/constants";
import { base } from "../base";
import { iso } from "../isolation";

const DEFAULTS = { tabGroups: false, pageBorder: false };
export type Settings = typeof DEFAULTS;

export const settings = (): Settings => ({ ...DEFAULTS, ...(iso.mirror[SETTINGS_KEY] || {}) });

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  await base.storage.local.set({ [SETTINGS_KEY]: { ...settings(), ...patch } });
}

/** The container record of a tab's container number (none for 0). */
export const identity = (n: number) => (n ? iso.identity(n) : undefined);
