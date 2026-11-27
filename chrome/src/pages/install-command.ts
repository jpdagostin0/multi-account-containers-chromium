/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Shell commands that install the proxy helper for this extension. */
export const installCommand = (extensionId: string) =>
  "git clone --recursive https://github.com/jpdagostin0/multi-account-containers-chromium\n"
  + "cd multi-account-containers-chromium/chrome/helper\n"
  + `./install.sh ${extensionId}`;
