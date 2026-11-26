/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Options page: per-container proxy status (Chromium port).
(() => {
  "use strict";
  const proxy = chrome.extension.getBackgroundPage().__maccProxy;
  const box = document.createElement("div");
  box.id = "macc-proxy-status";
  box.className = "settings-group";
  const anchor = document.querySelector(".moz-vpn-proxy-permissions") || document.body.lastElementChild;
  anchor.parentNode.insertBefore(box, anchor);

  function render() {
    const s = proxy.status();
    box.replaceChildren();
    const h = document.createElement("h3");
    h.textContent = "Per-container proxies";
    const p = document.createElement("p");
    const list = Object.entries(s.routes);
    if (!s.enabled) {
      p.textContent = "No container uses a proxy. Set one under a container's “Advanced proxy settings” in the toolbar panel.";
    } else if (s.helperRunning && s.applied) {
      p.textContent = `Active: helper ${s.version} is routing ${list.length} container(s).`;
    } else if (s.helperRunning) {
      p.textContent = `The helper is running, but the browser proxy setting is controlled by something else (${s.control}). Proxied containers are blocked until that is resolved.`;
    } else {
      p.textContent = `The proxy helper isn't running${s.error ? ` (${s.error})` : ""}. Proxied containers are blocked until it is. Install it with:`;
    }
    box.append(h, p);
    if (s.enabled && !s.helperRunning) {
      const pre = document.createElement("pre");
      pre.textContent = "git clone --recursive https://github.com/jpdagostin0/multi-account-containers-chromium\n"
        + "cd multi-account-containers-chromium/chrome/helper\n"
        + `./install.sh ${s.extensionId}`;
      box.append(pre);
    }
  }
  render();
  setInterval(render, 2000);
})();
