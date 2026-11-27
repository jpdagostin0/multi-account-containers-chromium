/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// browser.runtime whose onMessage hides our private (`__macc`) messages from
// the upstream handler, which throws on unknown methods.

import type { Listener } from "../lib/events";
import { base } from "./base";
import { overlay } from "./overlay";

const wrappers = new Map<Listener, Listener>();
const onMessage = {
  addListener(fn: Listener) {
    const wrapped = (msg: unknown, sender: unknown) =>
      ((msg as { __macc?: unknown } | null)?.__macc ? undefined : fn(msg, sender));
    wrappers.set(fn, wrapped);
    base.runtime.onMessage.addListener(wrapped as never);
  },
  removeListener(fn: Listener) {
    const w = wrappers.get(fn);
    if (w) base.runtime.onMessage.removeListener(w as never);
    wrappers.delete(fn);
  },
  hasListener: (fn: Listener) => wrappers.has(fn),
};

export const runtime = overlay(base.runtime, { onMessage });
