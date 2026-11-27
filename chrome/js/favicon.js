/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Container line on the tab icon (see highlight.js): swaps the page's icon
// links for a copy marked with the container color and follows the page's
// own icon changes. Runs as a content script and is also injected into tabs
// that were open before the extension (re)started; the newest instance wins.
(() => {
  "use strict";
  if (window !== window.top || !/^https?:$/.test(location.protocol)) return;
  const me = {};
  window.__maccFaviconInstance = me;
  const current = () => window.__maccFaviconInstance === me;

  const SEL = 'link[rel~="icon" i]';
  let marked = null; // data URL we installed
  let applying = false;
  let seq = 0;
  const iconLinks = () => [...document.querySelectorAll(SEL)];
  const pageIcon = () => {
    const link = iconLinks().find((l) => !l.hasAttribute("data-macc-added"));
    if (link) return link.dataset.maccOrig || link.href;
    return new URL("/favicon.ico", location.href).href;
  };
  function apply(url) {
    applying = true;
    const head = document.head || document.documentElement;
    if (url) {
      let links = iconLinks();
      if (!links.length) {
        const l = document.createElement("link");
        l.rel = "icon";
        l.setAttribute("data-macc-added", "");
        head.appendChild(l);
        links = [l];
      }
      for (const l of links) {
        if (!l.hasAttribute("data-macc-added") && l.dataset.maccOrig === undefined) {
          l.dataset.maccOrig = l.getAttribute("href") || "";
        }
        l.href = url;
      }
    } else {
      for (const l of iconLinks()) {
        if (l.hasAttribute("data-macc-added")) l.remove();
        else if (l.dataset.maccOrig !== undefined) {
          l.setAttribute("href", l.dataset.maccOrig);
          delete l.dataset.maccOrig;
        }
      }
    }
    marked = url;
    Promise.resolve().then(() => { applying = false; });
  }
  function refresh() {
    if (!current()) return;
    const mine = ++seq;
    try {
      chrome.runtime.sendMessage({ __macc: "favicon", href: pageIcon() }, (res) => {
        void chrome.runtime.lastError;
        if (current() && mine === seq && res) apply(res.url);
      });
    } catch { /* extension reloaded */ }
  }
  window.__maccRefreshFavicon = refresh;

  // The page changed its icon (e.g. unread counters): re-mark the new one.
  const watcher = new MutationObserver((records) => {
    if (!current()) {
      watcher.disconnect();
      return;
    }
    if (applying) return;
    let changed = false;
    for (const r of records) {
      if (r.type === "attributes" && r.target.matches && r.target.matches(SEL)
          && r.target.getAttribute("href") !== marked) {
        delete r.target.dataset.maccOrig;
        changed = true;
      }
      for (const n of r.addedNodes || []) {
        if (n.matches && n.matches(SEL) && !n.hasAttribute("data-macc-added")) changed = true;
      }
    }
    if (changed) refresh();
  });
  function start() {
    if (!current()) return;
    watcher.observe(document.head || document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeFilter: ["href", "rel"],
    });
    refresh();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
