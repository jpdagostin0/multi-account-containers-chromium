/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// A drawer that slides in from one side while the page shrinks into the space
// beside it. Opening one drawer closes the other.

export interface Drawer { isOpen(): boolean; setOpen(open: boolean): void }

const all: Drawer[] = [];

export function setUpDrawer(opts: {
  drawer: HTMLElement; toggle: HTMLElement; side: "start" | "end"; openClass: string;
  onOpen?: () => void; focus?: () => HTMLElement | null;
}): Drawer {
  const { drawer, toggle, side, openClass } = opts;
  const root = document.documentElement;
  const main = document.querySelector("main")!;

  // Shrink the page into the space beside the drawer, centred there. The
  // search box reaches past main's sides, so the widest child counts too.
  function fit(): void {
    const free = innerWidth - drawer.offsetWidth;
    const width = Math.max(main.offsetWidth, ...[...main.children].map((c) => (c as HTMLElement).offsetWidth));
    const scale = Math.min(1, (free - 16) / width);
    const shift = drawer.offsetWidth / 2;
    root.style.setProperty("--page-shift", `${side === "end" ? -shift : shift}px`);
    root.style.setProperty("--page-scale", String(Math.max(scale, 0.4)));
  }

  const isOpen = () => root.classList.contains(openClass);
  function setOpen(open: boolean): void {
    if (open === isOpen()) return;
    if (open) {
      for (const d of all) if (d !== self) d.setOpen(false);
      fit();
      opts.onOpen?.();
    }
    root.classList.toggle(openClass, open);
    toggle.setAttribute("aria-expanded", String(open));
    drawer.inert = !open;
    if (open) opts.focus?.()?.focus({ preventScroll: true });
  }
  const self: Drawer = { isOpen, setOpen };
  all.push(self);

  drawer.inert = true;
  addEventListener("resize", () => { if (isOpen()) fit(); });
  toggle.addEventListener("click", () => setOpen(!isOpen()));
  drawer.querySelector(".close")?.addEventListener("click", () => { setOpen(false); toggle.focus(); });
  main.addEventListener("click", (e) => { if (isOpen()) { e.preventDefault(); e.stopPropagation(); setOpen(false); } }, true);
  addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) setOpen(false); });
  return self;
}
