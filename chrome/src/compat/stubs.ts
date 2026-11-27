/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Small shims for Firefox APIs Chromium lacks or names differently.

import { base } from "./base";
import { overlay } from "./overlay";

export const browserAction = overlay(base.browserAction,
  // Firefox's typings always have it; Chromium MV2 doesn't.
  "setBadgeTextColor" in base.browserAction ? {} : { setBadgeTextColor: async () => {} });

export const commands = {
  ...base.commands,
  onCommand: base.commands.onCommand,
  getAll: base.commands.getAll,
  update: async () => {},
  reset: async () => {},
};

// Chromium only accepts [A-Za-z0-9_] in message names (build.mjs maps the
// locale files the same way).
export const i18n = {
  ...base.i18n,
  getMessage: (name: string, subs?: string | string[]) =>
    base.i18n.getMessage(String(name).replace(/[^A-Za-z0-9_]/g, "_"), subs),
};
