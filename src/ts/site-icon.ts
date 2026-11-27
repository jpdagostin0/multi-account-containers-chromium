/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Reports the page's icon to the background page, which saves one copy per
// site for the new tab and history pages (background/history/site-icons.ts).
// Runs as a content script in top frames, and is injected into tabs that were
// open before the extension (re)started.

(() => {
  if (window !== window.top || !/^https?:$/.test(location.protocol)) return;

  const SEL = 'link[rel~="icon" i]';

  // Older versions replaced the page's icon links with a container-marked
  // copy: put the page's own icons back.
  function restore(): void {
    for (const l of document.querySelectorAll<HTMLLinkElement>(SEL)) {
      if (l.hasAttribute("data-macc-added")) l.remove();
      else if (l.dataset.maccOrig !== undefined) {
        l.setAttribute("href", l.dataset.maccOrig);
        delete l.dataset.maccOrig;
      }
    }
  }

  function report(): void {
    restore();
    const link = document.querySelector<HTMLLinkElement>(SEL);
    const href = link?.href || new URL("/favicon.ico", location.href).href;
    try {
      chrome.runtime.sendMessage({ __macc: "favicon", href }, () => void chrome.runtime.lastError);
    } catch { /* extension reloaded */ }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", report, { once: true });
  else report();
})();
