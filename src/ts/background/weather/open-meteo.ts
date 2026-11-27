/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Open-Meteo (https://open-meteo.com): current conditions and place search
// (names or postal codes). Free, no key; fetched without cookies.

export interface Place { name: string; latitude: number; longitude: number; detail: string }

export interface Reading {
  temperature: number;
  feelsLike: number;
  code: number;
  isDay: boolean;
  windKmh: number;
  /** ISO time of the reading, in the place's time zone. */
  time: string;
}

export type Unit = "celsius" | "fahrenheit";

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(10000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) throw new Error(body?.reason || `Open-Meteo answered ${res.status}`);
  return body;
}

export async function forecast(latitude: number, longitude: number, unit: Unit): Promise<Reading> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m",
    temperature_unit: unit,
    wind_speed_unit: "kmh",
    timezone: "auto",
  }).toString();
  const { current: c } = await getJson(url.href);
  return {
    temperature: c.temperature_2m,
    feelsLike: c.apparent_temperature,
    code: c.weather_code,
    isDay: c.is_day === 1,
    windKmh: c.wind_speed_10m,
    time: c.time,
  };
}

/** Places matching a name or postal code ("10001", "Paris", "Portland, Maine"). */
export async function geocode(query: string): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({ name: q, count: "8", language: navigator.language.split("-")[0]!.toLowerCase(), format: "json" }).toString();
  const { results = [] } = await getJson(url.href);
  return (results as any[]).map((r) => ({
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    detail: [r.admin1, r.country].filter(Boolean).join(", "),
  }));
}
