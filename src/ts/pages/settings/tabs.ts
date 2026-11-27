/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tab behavior, keyboard shortcuts and onboarding (upstream's options).

import { ff } from "../../lib/ff";
import { card, el, toggle } from "./dom";

const SHORTCUTS = 10;

export function tabsSection(): HTMLElement {
  const replace = toggle("Replace the tab", "When a site always opens in a container, switch the current tab instead of opening a new one.",
    (on) => ff().storage.local.set({ replaceTabEnabled: on }));
  ff().storage.local.get("replaceTabEnabled").then(({ replaceTabEnabled }) => { replace.input.checked = !!replaceTabEnabled; });
  return card("Tabs", "How containers open sites.", replace.node);
}

export function shortcutsSection(): HTMLElement {
  const grid = el("div", { className: "shortcuts" });
  (async () => {
    const current = (await ff().runtime.sendMessage({ method: "getShortcuts" })) as Record<string, string> | undefined;
    const idents = await ff().contextualIdentities.query({});
    for (let i = 0; i < SHORTCUTS; i++) {
      const id = `open_container_${i}`;
      const select = el("select", {}, el("option", { value: "none", textContent: "None" }),
        ...idents.map((c) => el("option", { value: c.cookieStoreId, textContent: c.name })));
      select.value = current?.[id] ?? "none";
      if (!select.value) select.value = "none";
      select.addEventListener("change", () => ff().runtime.sendMessage({ method: "setShortcut", shortcut: id, cookieStoreId: select.value }));
      grid.append(el("label", {}, `Shortcut ${i + 1}`, select));
    }
  })();
  const keys = el("button", { type: "button", textContent: "Set the keys…" });
  keys.addEventListener("click", () => ff().tabs.create({ url: "chrome://extensions/shortcuts" }));
  return card("Keyboard shortcuts", "Which container each “Open container” shortcut opens. Set the keys themselves on the browser's shortcuts page.",
    grid, el("p", { className: "actions" }, keys));
}

export function onboardingSection(): HTMLElement {
  const reset = el("button", { type: "button", textContent: "Show the introduction again" });
  reset.addEventListener("click", async () => {
    await ff().storage.local.set({ "onboarding-stage": 0 });
    reset.textContent = "It shows next time you open the panel";
  });
  return card("Introduction", "The few panels the toolbar button shows the first time.", el("p", { className: "actions" }, reset));
}
