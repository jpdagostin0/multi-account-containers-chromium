/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The current weather, over the search box; hovering it slides the next five
// hours and three days out to its right. Nothing to click: it's set up in the
// settings drawer.

import type { Weather, WeatherSettings } from "../../background/weather";
import { condition } from "../../background/weather/conditions";
import { weatherIcon } from "./weather-icons";

const HOURS = 5, DAYS = 3;

const span = (className: string, text: string) => Object.assign(document.createElement("span"), { className, textContent: text });
const deg = (t: number) => `${Math.round(t)}°`;

// Open-Meteo's times are wall-clock times at the place; read them as UTC so
// they're shown as they are, whatever this computer's time zone.
const asUtc = (iso: string) => new Date(`${iso.length === 10 ? `${iso}T12:00` : iso}:00Z`);
const hourLabel = (iso: string) => asUtc(iso).toLocaleTimeString([], { hour: "numeric", timeZone: "UTC" });
const dayLabel = (iso: string, i: number) => (i === 0 ? "Today" : asUtc(iso).toLocaleDateString([], { weekday: "short", timeZone: "UTC" }));

function cell(when: string, code: number, isDay: boolean, temp: string, low?: string): HTMLElement {
  const { label } = condition(code, isDay);
  const node = Object.assign(document.createElement("div"), { className: "f-cell", title: label });
  const temps = span("f-temps", "");
  temps.append(weatherIcon(code, isDay), span("w-temp", temp), ...(low ? [span("f-low", low)] : []));
  node.append(span("f-when", when), temps, span("w-label", label));
  return node;
}

function forecastRows(w: Weather): HTMLElement[] {
  const { reading: r } = w;
  // A background page still running an older version sends readings without forecasts.
  if (!Array.isArray(r.hourly) || !Array.isArray(r.daily)) return [];
  // The place's clock now ("2026-11-27T18…"), so an hour-old reading still starts at the next hour.
  const now = new Date(Date.now() + (r.utcOffset || 0) * 1000).toISOString();
  const hours = r.hourly.filter((h) => h.time.slice(0, 13) > now.slice(0, 13)).slice(0, HOURS);
  const days = r.daily.filter((d) => d.date >= now.slice(0, 10)).slice(0, DAYS);
  const row = (className: string, title: string, cells: HTMLElement[]) => {
    const node = Object.assign(document.createElement("div"), { className: `f-row ${className}` });
    node.setAttribute("aria-label", title);
    node.append(...cells);
    return node;
  };
  return [
    ...(hours.length ? [row("hours", "Next hours", hours.map((h) => cell(hourLabel(h.time), h.code, h.isDay, deg(h.temperature))))] : []),
    ...(days.length ? [row("days", "Next days", days.map((d, i) => cell(dayLabel(d.date, i), d.code, true, deg(d.high), deg(d.low))))] : []),
  ];
}

// Past half the search box's width the forecast scrolls sideways: the mouse
// wheel scrolls it too, and the side with more to see fades out.
function markEdges(panel: HTMLElement): void {
  const end = panel.scrollWidth - panel.clientWidth;
  panel.classList.toggle("more-start", panel.scrollLeft > 1);
  panel.classList.toggle("more-end", panel.scrollLeft < end - 1);
}

let scrollWired = false;
function wireScrolling(panel: HTMLElement): void {
  if (scrollWired) return;
  scrollWired = true;
  panel.addEventListener("wheel", (e) => {
    if (panel.scrollWidth <= panel.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    panel.scrollLeft += e.deltaY;
  }, { passive: false });
  panel.addEventListener("scroll", () => markEdges(panel), { passive: true });
  // The panel grows when hovered; check again once it has.
  panel.addEventListener("transitionend", () => markEdges(panel));
  new ResizeObserver(() => markEdges(panel)).observe(panel);
}

export function renderWeather(s: WeatherSettings, w: Weather | null, failed: boolean): void {
  const box = document.getElementById("weather-box")!;
  const a = document.getElementById("weather")!;
  const panel = document.getElementById("forecast")!;
  // Without a place there's nothing to show.
  box.hidden = !s.show || (!w && !failed);
  a.classList.toggle("unset", !w);
  if (box.hidden) return;
  if (!w) {
    a.title = "";
    a.replaceChildren(span("w-label", "Weather unavailable"));
    panel.replaceChildren();
    return;
  }
  const { reading: r, condition: c, place } = w;
  const at = new Date(w.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  a.title = `${c.label} in ${place.name}${place.detail ? `, ${place.detail}` : ""}. Feels like ${deg(r.feelsLike)}${w.unit === "fahrenheit" ? "F" : "C"}. Updated ${at}.`;
  const text = span("w-text", "");
  text.append(span("w-label", c.label), span("w-place", `${place.name} · feels ${deg(r.feelsLike)}`));
  a.replaceChildren(weatherIcon(r.code, r.isDay), span("w-temp", deg(r.temperature)), text);
  panel.replaceChildren(...forecastRows(w));
  wireScrolling(panel);
  markEdges(panel);
}
