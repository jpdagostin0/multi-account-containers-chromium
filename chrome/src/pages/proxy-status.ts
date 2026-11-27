/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Why a navigation was stopped by the proxy module, and how to continue.

import { DEFAULT } from "../lib/constants";
import { ff } from "../lib/ff";
import { backgroundPage } from "./background";
import { installCommand } from "./install-command";

const params = new URLSearchParams(location.search);
const reason = params.get("reason") || "";
const url = params.get("url") || "";
const site = params.get("site") || "";
const proxy = backgroundPage().__maccProxy;
const browser = ff();

const safe = URL.canParse(url) && /^https?:$/.test(new URL(url).protocol);
const go = () => { if (safe) location.replace(url); };
const byId = (id: string) => document.getElementById(id)!;

async function containerName(csid: string | null): Promise<string> {
  if (!csid || csid === DEFAULT) return "No container";
  try { return (await browser.contextualIdentities.get(csid)).name; } catch { return csid; }
}

function fill(attr: string, text: string): void {
  document.querySelectorAll(`[data-${attr}]`).forEach((el) => { el.textContent = text; });
}

function whenHelperReturns(): void {
  const s = proxy.status();
  byId("install").textContent = installCommand(s.extensionId);
  byId("error").textContent = s.error ? `Last error: ${s.error}` : "";
  const poll = setInterval(() => {
    const now = proxy.status();
    if (now.helperRunning && now.applied) {
      clearInterval(poll);
      go();
    }
  }, 500);
  byId("retry").addEventListener("click", () => {
    proxy.retry();
    setTimeout(() => {
      if (proxy.status().helperRunning) go();
      else byId("error").textContent = `Last error: ${proxy.status().error || "not running"}`;
    }, 1000);
  });
}

async function resolveConflict(): Promise<void> {
  const me = await browser.tabs.getCurrent();
  const holders = () => proxy.holdersOf(site).filter((t) => t !== me.id);
  byId("close-others").addEventListener("click", async () => {
    await browser.tabs.remove(holders());
    await new Promise((r) => setTimeout(r, 50));
    await proxy.waitFlushed(site);
    go();
  });
  byId("show-other").addEventListener("click", async () => {
    const [tabId] = holders();
    if (tabId === undefined) return go();
    const tab = await browser.tabs.update(tabId, { active: true });
    await browser.windows.update(tab.windowId!, { focused: true });
  });
}

fill("url", url);
fill("site", site);
fill("ctx", await containerName(params.get("ctx")));
fill("other", await containerName(params.get("other")));
const section = document.getElementById(reason);
if (section) section.hidden = false;

if (reason === "wait") {
  await proxy.waitFlushed(site);
  go();
} else if (reason === "unavailable") {
  whenHelperReturns();
} else if (reason === "conflict") {
  await resolveConflict();
}
