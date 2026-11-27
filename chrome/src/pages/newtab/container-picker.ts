/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Dropdown of containers ("All containers" first), with their icons.

import { identIcon, type Container } from "../containers";

export interface Picker { el: HTMLElement; value: number | null; set(n: number | null): void }

export function containerPicker(containers: Container[], onChange: (n: number | null) => void): Picker {
  const el = document.createElement("div");
  el.className = "picker";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "picker-button";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  const list = document.createElement("ul");
  list.className = "picker-list";
  list.setAttribute("role", "listbox");
  el.append(button, list);

  const byN = new Map(containers.map((c) => [c.n, c]));
  const label = (c: Container | null) => {
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = c ? c.name : "All containers";
    return [identIcon(c), name];
  };
  const tint = (node: HTMLElement, c: Container | null) => {
    if (c?.color) node.style.setProperty("--c", c.color);
    else node.style.removeProperty("--c");
  };

  const options = [null, ...containers].map((c) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.tabIndex = -1;
    li.dataset.n = c ? String(c.n) : "all";
    tint(li, c);
    li.append(...label(c));
    li.addEventListener("click", () => {
      close();
      button.focus();
      if (picker.value !== (c?.n ?? null)) {
        picker.set(c?.n ?? null);
        onChange(picker.value);
      }
    });
    list.append(li);
    return li;
  });

  const open = () => {
    el.classList.add("open");
    button.setAttribute("aria-expanded", "true");
    list.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  };
  function close() {
    el.classList.remove("open");
    button.setAttribute("aria-expanded", "false");
  }
  button.addEventListener("click", () => (el.classList.contains("open") ? close() : open()));
  document.addEventListener("pointerdown", (e) => { if (!el.contains(e.target as Node)) close(); });
  el.addEventListener("keydown", (e) => {
    if (!el.classList.contains("open")) return;
    const i = options.indexOf(document.activeElement as HTMLLIElement);
    if (e.key === "Escape") { e.stopPropagation(); close(); button.focus(); }
    else if (e.key === "ArrowDown") options[Math.min(i + 1, options.length - 1)]!.focus();
    else if (e.key === "ArrowUp") options[Math.max(i - 1, 0)]!.focus();
    else if (e.key === "Enter" && i >= 0) options[i]!.click();
    else return;
    e.preventDefault();
  });

  const picker: Picker = {
    el,
    value: null,
    set(n) {
      picker.value = n;
      const c = n === null ? null : byN.get(n)!;
      tint(button, c);
      button.replaceChildren(...label(c));
      for (const o of options) o.setAttribute("aria-selected", String(o.dataset.n === (n === null ? "all" : String(n))));
    },
  };
  return picker;
}
