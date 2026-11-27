/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Building blocks of the settings page.

/** Create an element with properties and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

/** A settings card. */
export const card = (title: string, hint: string, ...kids: Node[]) =>
  el("section", { className: "card" }, el("h2", { textContent: title }), el("p", { className: "hint", textContent: hint }), ...kids);

/** A labelled on/off switch. */
export function toggle(label: string, desc: string, onChange: (on: boolean) => void) {
  const input = el("input", { type: "checkbox", className: "switch" });
  input.addEventListener("change", () => onChange(input.checked));
  const node = el("label", { className: "setting" },
    el("span", { className: "setting-text" }, el("span", { className: "setting-label", textContent: label }), el("span", { className: "setting-desc", textContent: desc })),
    input);
  return { node, input };
}

/** A labelled text field. */
export function field(label: string, placeholder: string) {
  const input = el("input", { type: "text", placeholder, spellcheck: false });
  return { node: el("label", { className: "field" }, el("span", { textContent: label }), input), input };
}

/** "Saved" note that fades out; errors stay. */
export function savedNote() {
  const node = el("span", { className: "saved", textContent: "Saved" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    node,
    ok() {
      clearTimeout(timer);
      node.className = "saved show";
      node.textContent = "Saved";
      timer = setTimeout(() => node.classList.remove("show"), 1500);
    },
    error(message: string) {
      clearTimeout(timer);
      node.className = "saved error";
      node.textContent = message;
    },
  };
}
