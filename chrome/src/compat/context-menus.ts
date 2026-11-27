/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// browser.contextMenus: Chromium has no "bookmark"/"tab" contexts and no
// icons. Items that would only show in missing contexts are skipped.

import { base } from "./base";
import type { AnyRecord } from "./overlay";

const CHROME_CONTEXTS = new Set([
  "all", "page", "frame", "selection", "link", "editable", "image", "video",
  "audio", "browser_action", "page_action", "action",
]);
const skipped = new Set<string | number>();

export const contextMenus = {
  ...base.contextMenus,
  create(props: AnyRecord, cb?: () => void) {
    const { icons, viewTypes, command, ...p } = props;
    if (p.contexts) {
      p.contexts = (p.contexts as string[]).filter((c) => CHROME_CONTEXTS.has(c));
      if (!p.contexts.length) {
        skipped.add(p.id);
        return p.id;
      }
    }
    if (p.parentId !== undefined && skipped.has(p.parentId)) {
      skipped.add(p.id);
      return p.id;
    }
    return chrome.contextMenus.create(p as chrome.contextMenus.CreateProperties, () => {
      void chrome.runtime.lastError;
      cb?.();
    });
  },
  async update(id: string | number, props: AnyRecord) {
    if (skipped.has(id)) return;
    const { icons, ...p } = props;
    try { await base.contextMenus.update(id, p); } catch { /* missing item */ }
  },
  async remove(id: string | number) {
    if (skipped.delete(id)) return;
    try { await base.contextMenus.remove(id); } catch { /* missing item */ }
  },
  removeAll: () => { skipped.clear(); return base.contextMenus.removeAll(); },
  onClicked: base.contextMenus.onClicked,
};
