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
  /** The place's offset from UTC, in seconds. */
  utcOffset: number;
  /** The coming hours, from the current one (ISO times in the place's time zone). */
  hourly: { time: string; temperature: number; code: number; isDay: boolean }[];
  /** Today and the next days (ISO dates). */
  daily: { date: string; high: number; low: number; code: number }[];
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
    // Kept an hour, so a few more than the five shown.
    hourly: "temperature_2m,weather_code,is_day",
    forecast_hours: "8",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    forecast_days: "3",
    temperature_unit: unit,
    wind_speed_unit: "kmh",
    timezone: "auto",
  }).toString();
  const { current: c, hourly: h, daily: d, utc_offset_seconds } = await getJson(url.href);
  return {
    temperature: c.temperature_2m,
    feelsLike: c.apparent_temperature,
    code: c.weather_code,
    isDay: c.is_day === 1,
    windKmh: c.wind_speed_10m,
    time: c.time,
    utcOffset: utc_offset_seconds ?? 0,
    hourly: ((h?.time ?? []) as string[]).map((time, i) => ({
      time, temperature: h.temperature_2m[i], code: h.weather_code[i], isDay: h.is_day[i] === 1,
    })),
    daily: ((d?.time ?? []) as string[]).map((date, i) => ({
      date, high: d.temperature_2m_max[i], low: d.temperature_2m_min[i], code: d.weather_code[i],
    })),
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
