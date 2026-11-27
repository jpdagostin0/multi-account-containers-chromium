/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Weather on the new tab page (Open-Meteo): where, which units, and the pixel
// art effect it plays. The place comes from the browser's location (it asks
// first) or a search by name or postal code.

import type { Place, WeatherApi, WeatherSettings } from "../../background/weather";
import { card, el, savedNote, toggle } from "./dom";

const UNITS: [WeatherSettings["units"], string][] = [["auto", "Auto"], ["celsius", "°C"], ["fahrenheit", "°F"]];

const placeText = (p: Place | null) => (p ? [p.name, p.detail].filter(Boolean).join(", ") : "Not set");

function locate(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 20000, maximumAge: 30 * 60 * 1000 }));
}

function locateError(e: GeolocationPositionError): string {
  if (e.code === e.PERMISSION_DENIED) return "Location access was blocked. Allow it for this extension, or search for your city or postal code.";
  return "The browser couldn't find your location. Search for your city or postal code instead.";
}

export function weatherSection(weather: WeatherApi): HTMLElement {
  let s: WeatherSettings | null = null;
  const note = savedNote();
  const save = async (patch: Partial<WeatherSettings>) => {
    await weather.set(patch);
    s = await weather.settings();
    render();
    note.ok();
  };

  const show = toggle("Show the weather", "The temperature and conditions under the container tabs.", (on) => save({ show: on }));

  const where = el("span", { className: "setting-label" });
  const mine = el("button", { type: "button", textContent: "Use my location" });
  mine.addEventListener("click", async () => {
    mine.disabled = true;
    mine.textContent = "Locating…";
    try {
      const { coords } = await locate();
      await save({ place: { name: "My location", detail: `${coords.latitude.toFixed(2)}, ${coords.longitude.toFixed(2)}`, latitude: coords.latitude, longitude: coords.longitude } });
    } catch (e) {
      note.error(locateError(e as GeolocationPositionError));
    } finally {
      mine.disabled = false;
      mine.textContent = "Use my location";
    }
  });
  const location = el("div", { className: "setting" },
    el("span", { className: "setting-text" }, el("span", { className: "setting-desc", textContent: "Location" }), where), mine);

  const query = el("input", { type: "text", placeholder: "City or postal code", spellcheck: false });
  const find = el("button", { type: "button", textContent: "Find" });
  const results = el("ul", { className: "places" });
  const search = async () => {
    results.replaceChildren();
    try {
      const places = await weather.geocode(query.value);
      if (!places.length) return note.error("No place by that name or postal code.");
      for (const p of places) {
        const b = el("button", { type: "button" }, el("span", { textContent: p.name }), el("span", { className: "setting-desc", textContent: p.detail }));
        b.addEventListener("click", async () => {
          results.replaceChildren();
          query.value = "";
          await save({ place: p });
        });
        results.append(el("li", {}, b));
      }
    } catch (e) {
      note.error((e as Error).message);
    }
  };
  find.addEventListener("click", search);
  query.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });

  const units = el("div", { className: "segmented", role: "group" });
  const unitButtons = UNITS.map(([u, label]) => {
    const b = el("button", { type: "button", textContent: label });
    b.addEventListener("click", () => save({ units: u }));
    units.append(b);
    return [u, b] as const;
  });

  const effects = el("select", {},
    el("option", { value: "auto", textContent: "Follow the weather" }),
    el("option", { value: "off", textContent: "Off" }),
    ...weather.effects.map((e) => el("option", { value: e, textContent: weather.effectNames[e] })));
  effects.addEventListener("change", () => save({ effects: effects.value as WeatherSettings["effects"] }));

  function render(): void {
    if (!s) return;
    show.input.checked = s.show;
    where.textContent = placeText(s.place);
    for (const [u, b] of unitButtons) b.setAttribute("aria-pressed", String(s.units === u));
    effects.value = s.effects;
  }
  weather.settings().then((v) => { s = v; render(); });

  const section = card("Weather",
    "Current conditions from Open-Meteo, with pixel art rain, snow, clouds and the like behind the new tab page.",
    show.node, location,
    el("div", { className: "place-search" }, query, find), results,
    el("div", { className: "setting" }, el("span", { className: "setting-label", textContent: "Units" }), units),
    el("label", { className: "setting" },
      el("span", { className: "setting-text" }, el("span", { className: "setting-label", textContent: "Effects" }), el("span", { className: "setting-desc", textContent: "Pixel art weather behind the new tab page." })),
      effects),
    el("p", { className: "actions" }, note.node));
  section.id = "weather";
  return section;
}
