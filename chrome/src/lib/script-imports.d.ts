/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// `import source from "./entry?script"`: the entry module (and everything it
// imports) bundled by build.mjs into one self-contained JavaScript
// expression that evaluates to the entry's default export. Used for code that
// runs somewhere else: the page's main world, or tabs.executeScript().
declare module "*?script" {
  const source: string;
  export default source;
}
