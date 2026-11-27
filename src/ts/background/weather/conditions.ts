/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Open-Meteo's WMO weather codes: a label, and the new tab page's pixel art
// effect (pixelfx's weather loops) with how dense it falls.

/** The effects the new tab page can play (pixelfx/fx/weather/<name>). */
export const EFFECTS = ["rain", "storm", "snow", "blizzard", "clouds", "fog", "god-rays", "shooting-stars"] as const;
export type Effect = (typeof EFFECTS)[number];

export const EFFECT_NAMES: Record<Effect, string> = {
  rain: "Rain",
  storm: "Thunderstorm",
  snow: "Snow",
  blizzard: "Blizzard",
  clouds: "Clouds",
  fog: "Fog",
  "god-rays": "Sun rays",
  "shooting-stars": "Shooting stars",
};

/** The sky behind an effect. */
export type Sky = "clear" | "cloudy" | "rain" | "storm" | "snow";

/** effect: null for a clear day, which is just the bright sky. */
export interface Condition { label: string; effect: Effect | null; density: number; sky: Sky }

const clear = (isDay: boolean): Effect | null => (isDay ? null : "shooting-stars");

export function condition(code: number, isDay: boolean): Condition {
  const c = (label: string, effect: Effect | null, sky: Sky, density = 1): Condition => ({ label, effect, density, sky });
  switch (code) {
    case 0: return c(isDay ? "Clear" : "Clear night", clear(isDay), "clear");
    case 1: return c("Mainly clear", clear(isDay), "clear");
    case 2: return c("Partly cloudy", "clouds", "clear");
    case 3: return c("Overcast", "clouds", "cloudy");
    case 45: return c("Fog", "fog", "cloudy");
    case 48: return c("Freezing fog", "fog", "cloudy");
    case 51: return c("Light drizzle", "rain", "rain", 0.3);
    case 53: return c("Drizzle", "rain", "rain", 0.4);
    case 55: return c("Heavy drizzle", "rain", "rain", 0.55);
    case 56: return c("Freezing drizzle", "rain", "rain", 0.4);
    case 57: return c("Heavy freezing drizzle", "rain", "rain", 0.55);
    case 61: return c("Light rain", "rain", "rain", 0.6);
    case 63: return c("Rain", "rain", "rain", 1);
    case 65: return c("Heavy rain", "rain", "rain", 1.4);
    case 66: return c("Freezing rain", "rain", "rain", 0.7);
    case 67: return c("Heavy freezing rain", "rain", "rain", 1.3);
    case 71: return c("Light snow", "snow", "snow");
    case 73: return c("Snow", "snow", "snow");
    case 75: return c("Heavy snow", "blizzard", "snow");
    case 77: return c("Snow grains", "snow", "snow");
    case 80: return c("Light showers", "rain", "rain", 0.6);
    case 81: return c("Showers", "rain", "rain", 1);
    case 82: return c("Violent showers", "rain", "rain", 1.5);
    case 85: return c("Snow showers", "snow", "snow");
    case 86: return c("Heavy snow showers", "blizzard", "snow");
    case 95: return c("Thunderstorm", "storm", "storm");
    case 96: return c("Thunderstorm with hail", "storm", "storm");
    case 99: return c("Thunderstorm with heavy hail", "storm", "storm");
    default: return c("Unknown", "clouds", "cloudy");
  }
}

/** The sky an effect picked by hand goes with. */
export const SKY_OF: Record<Effect, Sky> = {
  rain: "rain", storm: "storm", snow: "snow", blizzard: "snow", clouds: "cloudy", fog: "cloudy", "god-rays": "clear", "shooting-stars": "clear",
};
