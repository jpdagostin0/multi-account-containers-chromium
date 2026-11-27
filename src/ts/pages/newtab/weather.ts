/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The current weather, under the container tabs. Opens its settings.

import type { Weather, WeatherSettings } from "../../background/weather";

const span = (className: string, text: string) => Object.assign(document.createElement("span"), { className, textContent: text });
const deg = (t: number) => `${Math.round(t)}°`;

export function renderWeather(s: WeatherSettings, w: Weather | null, failed: boolean): void {
  const a = document.getElementById("weather")!;
  a.hidden = !s.show;
  a.classList.toggle("unset", !w);
  if (!s.show) return;
  if (!w) {
    a.title = "Weather settings";
    a.replaceChildren(span("w-label", failed ? "Weather unavailable" : "Set up weather"));
    return;
  }
  const { reading: r, condition: c, place } = w;
  const at = new Date(w.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  a.title = `${c.label} in ${place.name}${place.detail ? `, ${place.detail}` : ""}. Feels like ${deg(r.feelsLike)}${w.unit === "fahrenheit" ? "F" : "C"}. Updated ${at}.`;
  a.replaceChildren(
    span("w-temp", deg(r.temperature)),
    Object.assign(document.createElement("span"), { className: "w-text" }),
  );
  a.lastElementChild!.append(span("w-label", c.label), span("w-place", `${place.name} · feels ${deg(r.feelsLike)}`));
}
