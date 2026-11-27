/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The Firefox add-on registers an async blocking onBeforeRequest to send
// sites to their assigned container. Chromium ignores promises from blocking
// listeners, so the isolation engine does that job synchronously and the
// upstream listener is dropped here.

import type { Listener } from "../lib/events";
import { isBackground } from "./background";
import { base } from "./base";
import { overlay } from "./overlay";

function withoutBlockingOnBeforeRequest(webRequest: typeof base.webRequest) {
  const obr = webRequest.onBeforeRequest;
  return overlay(webRequest, {
    onBeforeRequest: {
      ...obr,
      addListener(fn: Listener, filter: unknown, extra?: string[]) {
        if (extra && extra.includes("blocking")) return;
        (obr.addListener as Listener)(fn, filter, extra);
      },
      removeListener: (fn: Listener) => obr.removeListener(fn as never),
      hasListener: (fn: Listener) => obr.hasListener(fn as never),
    },
  });
}

export const webRequest = isBackground && base.webRequest
  ? withoutBlockingOnBeforeRequest(base.webRequest)
  : base.webRequest;
