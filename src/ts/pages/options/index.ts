/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Options page additions for the Chromium port: container highlighting and
// per-container proxy status.

import { backgroundPage } from "../background";
import { highlightingSection } from "./highlighting";
import { proxiesSection } from "./proxies";

const page = backgroundPage();
const anchor = document.querySelector('[data-i18n-message-id="tabBehavior"]')!;
const sections = [highlightingSection(page.__maccHighlight), proxiesSection(page.__maccProxy)];
for (const s of sections) anchor.parentNode!.insertBefore(s.node, anchor);

const render = () => sections.forEach((s) => s.render());
render();
setInterval(render, 2000);
