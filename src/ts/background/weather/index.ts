/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Weather for the new tab page (settings page: place, units, effects). The
// last reading is kept for 15 minutes, so new tabs don't each ask Open-Meteo.

import { base } from "../base";
import { condition, EFFECT_NAMES, EFFECTS, type Condition, type Effect } from "./conditions";
import { forecast, geocode, type Place, type Reading, type Unit } from "./open-meteo";

export type { Effect, Sky } from "./conditions";
export type { Place } from "./open-meteo";

export const WEATHER_KEY = "__macc_weather";
const CACHE_KEY = "__macc_weather_cache";
const FRESH_MS = 15 * 60 * 1000;

export interface WeatherSettings {
  show: boolean;
  /** Where; null until the user picks a place or shares their location. */
  place: Place | null;
  units: "auto" | Unit;
  /** "auto" follows the weather. */
  effects: "auto" | "off" | Effect;
}

export interface Weather { place: Place; unit: Unit; reading: Reading; condition: Condition; fetchedAt: number }

const DEFAULTS: WeatherSettings = { show: true, place: null, units: "auto", effects: "auto" };

function parse(stored: unknown): WeatherSettings {
  const s = (stored ?? {}) as Partial<WeatherSettings>;
  const p = s.place;
  return {
    show: typeof s.show === "boolean" ? s.show : DEFAULTS.show,
    place: p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) ? { name: String(p.name ?? ""), latitude: p.latitude, longitude: p.longitude, detail: String(p.detail ?? "") } : null,
    units: s.units === "celsius" || s.units === "fahrenheit" ? s.units : "auto",
    effects: s.effects === "off" || EFFECTS.includes(s.effects as Effect) ? s.effects! : "auto",
  };
}

// Fahrenheit where people use it.
const unitOf = (s: WeatherSettings): Unit =>
  s.units !== "auto" ? s.units : /-(US|LR|MM|BS|BZ|KY|PW)\b/i.test(navigator.language) ? "fahrenheit" : "celsius";

async function settings(): Promise<WeatherSettings> {
  const { [WEATHER_KEY]: s } = await base.storage.local.get(WEATHER_KEY);
  return parse(s);
}

let pending: Promise<Weather | null> | null = null;

async function load(force: boolean): Promise<Weather | null> {
  const s = await settings();
  if (!s.place) return null;
  const unit = unitOf(s);
  const key = `${s.place.latitude},${s.place.longitude},${unit}`;
  const { [CACHE_KEY]: cached } = (await base.storage.local.get(CACHE_KEY)) as { [CACHE_KEY]?: { key: string; weather: Weather } };
  if (!force && cached?.key === key && Date.now() - cached.weather.fetchedAt < FRESH_MS) return { ...cached.weather, place: s.place };
  try {
    const reading = await forecast(s.place.latitude, s.place.longitude, unit);
    const weather: Weather = { place: s.place, unit, reading, condition: condition(reading.code, reading.isDay), fetchedAt: Date.now() };
    await base.storage.local.set({ [CACHE_KEY]: { key, weather } });
    return weather;
  } catch (e) {
    // Offline or Open-Meteo down: an older reading beats none.
    if (cached?.key === key) return { ...cached.weather, place: s.place };
    throw e;
  }
}

export const weather = {
  settings,
  async set(patch: Partial<WeatherSettings>): Promise<void> {
    await base.storage.local.set({ [WEATHER_KEY]: parse({ ...(await settings()), ...patch }) });
  },
  /** The current weather at the chosen place (null without one). */
  current(force = false): Promise<Weather | null> {
    if (force || !pending) pending = load(force).finally(() => { pending = null; });
    return pending;
  },
  geocode,
  storageKey: WEATHER_KEY,
  effects: EFFECTS,
  effectNames: EFFECT_NAMES,
};
export type WeatherApi = typeof weather;
