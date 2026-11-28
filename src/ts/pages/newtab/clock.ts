/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The time and date at the right end of the weather strip, ticking over on
// the minute.

export function startClock(node: HTMLElement): void {
  const time = Object.assign(document.createElement("span"), { className: "c-time" });
  const date = Object.assign(document.createElement("span"), { className: "c-date" });
  node.replaceChildren(time, date);
  const show = () => {
    const now = new Date();
    time.textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    date.textContent = now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    node.title = now.toLocaleDateString([], { dateStyle: "full" });
    return now;
  };
  const tick = () => {
    const now = show();
    // Line up with the next minute each time, since timers drift.
    setTimeout(tick, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
  };
  tick();
  // Background tabs get late timers; a tab coming back shows the time at once.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) show(); });
}
