/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Options page additions for the Chromium port: container highlighting and
// per-container proxy status.
(() => {
  "use strict";
  const page = chrome.extension.getBackgroundPage();
  const proxy = page.__maccProxy;
  const highlight = page.__maccHighlight;
  const anchor = document.querySelector(".moz-vpn-proxy-permissions") || document.body.lastElementChild;

  function el(tag, props = {}, ...kids) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids);
    return node;
  }

  // ---- highlighting --------------------------------------------------------
  const hl = el("div", { id: "macc-highlight", className: "settings-group" });
  anchor.parentNode.insertBefore(hl, anchor);
  function toggle(key, title, description) {
    const input = el("input", { type: "checkbox", id: `macc-${key}` });
    input.addEventListener("change", () => highlight.setSettings({ [key]: input.checked }));
    const label = el("label", {}, input, el("span", { className: "bold", textContent: ` ${title}` }));
    return { input, node: el("div", { className: "settings-group" }, label, el("p", {}, el("em", { textContent: description }))) };
  }
  const faviconToggle = toggle("faviconMarker", "Colored line on tab icons",
    "Draw a line in the container's color down the left edge of container tabs' icons. Works in horizontal and vertical tabs.");
  const groupsToggle = toggle("tabGroups", "Group container tabs",
    "Put each container's tabs in a tab group named and colored after the container (needs the tab group companion).");
  const borderToggle = toggle("pageBorder", "Colored page border",
    "Draw a thin frame in the container's color around pages open in a container.");
  const companionNote = el("p", { id: "macc-companion-status" });
  hl.append(el("h3", { textContent: "Container highlighting" }), faviconToggle.node, borderToggle.node, groupsToggle.node, companionNote);

  // ---- proxies -------------------------------------------------------------
  const px = el("div", { id: "macc-proxy-status", className: "settings-group" });
  anchor.parentNode.insertBefore(px, anchor);

  function render() {
    const h = highlight.status();
    faviconToggle.input.checked = h.faviconMarker;
    groupsToggle.input.checked = h.tabGroups;
    borderToggle.input.checked = h.pageBorder;
    companionNote.replaceChildren();
    if (h.tabGroups && !h.companion.available) {
      companionNote.append(
        "Tab groups need the small “tab group colors” companion extension, because Chromium only lets "
        + "Manifest V3 extensions color tab groups. Load ",
        el("code", { textContent: "multi-account-containers-chromium-tabgroups-*.zip" }),
        " from the releases page (or ", el("code", { textContent: "dist/chromium-tabgroups" }), ") unpacked.");
    } else if (h.tabGroups) {
      companionNote.textContent = `Tab group companion ${h.companion.version} is active.`;
    }

    const s = proxy.status();
    const p = el("p");
    const n = Object.keys(s.routes).length;
    if (!s.enabled) {
      p.textContent = "No container uses a proxy. Set one under a container's “Advanced proxy settings” in the toolbar panel.";
    } else if (s.helperRunning && s.applied) {
      p.textContent = `Active: helper ${s.version} is routing ${n} container(s).`;
    } else if (s.helperRunning) {
      p.textContent = `The helper is running, but the browser proxy setting is controlled by something else (${s.control}). Proxied containers are blocked until that is resolved.`;
    } else {
      p.textContent = `The proxy helper isn't running${s.error ? ` (${s.error})` : ""}. Proxied containers are blocked until it is. Install it with:`;
    }
    px.replaceChildren(el("h3", { textContent: "Per-container proxies" }), p);
    if (s.enabled && !s.helperRunning) {
      px.append(el("pre", {
        textContent: "git clone --recursive https://github.com/jpdagostin0/multi-account-containers-chromium\n"
          + "cd multi-account-containers-chromium/chrome/helper\n"
          + `./install.sh ${s.extensionId}`,
      }));
    }
  }
  render();
  setInterval(render, 2000);
})();
