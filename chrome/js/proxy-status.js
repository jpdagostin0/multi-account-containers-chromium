/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

(async () => {
  "use strict";
  const params = new URLSearchParams(location.search);
  const reason = params.get("reason");
  const url = params.get("url");
  const page = chrome.extension.getBackgroundPage();
  const proxy = page.__maccProxy;

  const safe = (() => {
    try { return /^https?:$/.test(new URL(url).protocol); } catch { return false; }
  })();
  const go = () => { if (safe) location.replace(url); };

  async function containerName(csid) {
    if (!csid || csid === "firefox-default") return "No container";
    try { return (await browser.contextualIdentities.get(csid)).name; } catch { return csid; }
  }

  document.querySelectorAll("[data-url]").forEach((el) => { el.textContent = url; });
  document.querySelectorAll("[data-site]").forEach((el) => { el.textContent = params.get("site"); });
  const ctxName = await containerName(params.get("ctx"));
  const otherName = await containerName(params.get("other"));
  document.querySelectorAll("[data-ctx]").forEach((el) => { el.textContent = ctxName; });
  document.querySelectorAll("[data-other]").forEach((el) => { el.textContent = otherName; });

  const section = document.getElementById(reason);
  if (section) section.hidden = false;

  if (reason === "wait") {
    await proxy.waitFlushed(params.get("site"));
    go();
  }

  if (reason === "unavailable") {
    const s = proxy.status();
    document.getElementById("install").textContent =
      "git clone --recursive https://github.com/jpdagostin0/multi-account-containers-chromium\n"
      + "cd multi-account-containers-chromium/chrome/helper\n"
      + `./install.sh ${s.extensionId}`;
    document.getElementById("error").textContent = s.error ? `Last error: ${s.error}` : "";
    const poll = setInterval(() => {
      const now = proxy.status();
      if (now.helperRunning && now.applied) {
        clearInterval(poll);
        go();
      }
    }, 500);
    document.getElementById("retry").addEventListener("click", () => {
      proxy.retry();
      setTimeout(() => {
        if (proxy.status().helperRunning) go();
        else document.getElementById("error").textContent = `Last error: ${proxy.status().error || "not running"}`;
      }, 1000);
    });
  }

  if (reason === "conflict") {
    const site = params.get("site");
    const me = await browser.tabs.getCurrent();
    const holders = () => proxy.holdersOf(site).filter((t) => t !== me.id);
    document.getElementById("close-others").addEventListener("click", async () => {
      await browser.tabs.remove(holders());
      await new Promise((r) => setTimeout(r, 50));
      await proxy.waitFlushed(site);
      go();
    });
    document.getElementById("show-other").addEventListener("click", async () => {
      const [tabId] = holders();
      if (tabId === undefined) return go();
      const tab = await browser.tabs.update(tabId, { active: true });
      await browser.windows.update(tab.windowId, { focused: true });
    });
  }
})();
