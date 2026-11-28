/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Lucide's weather icons (lucide-static, ISC) for Open-Meteo's WMO codes.
// They stroke with currentColor, so they follow the page's colors.

import {
  Cloud, CloudDrizzle, CloudFog, CloudHail, CloudLightning, CloudMoon, CloudMoonRain, CloudRain, CloudRainWind,
  CloudSnow, CloudSun, CloudSunRain, Cloudy, Moon, Snowflake, Sun,
} from "lucide-static";

function svgFor(code: number, isDay: boolean): string {
  switch (code) {
    case 0: case 1: return isDay ? Sun : Moon;
    case 2: return isDay ? CloudSun : CloudMoon;
    case 3: return Cloudy;
    case 45: case 48: return CloudFog;
    case 51: case 53: case 55: case 56: case 57: return CloudDrizzle;
    case 61: case 63: case 66: return CloudRain;
    case 65: case 67: return CloudRainWind;
    case 71: case 73: case 77: case 85: return CloudSnow;
    case 75: case 86: return Snowflake;
    case 80: case 81: case 82: return isDay ? CloudSunRain : CloudMoonRain;
    case 95: return CloudLightning;
    case 96: case 99: return CloudHail;
    default: return Cloud;
  }
}

const parsed = new Map<string, SVGElement>();

/** The icon for a weather code, as a decorative (aria-hidden) element. */
export function weatherIcon(code: number, isDay: boolean): SVGElement {
  const svg = svgFor(code, isDay);
  let node = parsed.get(svg);
  if (!node) {
    // Lucide's source is indented; the whitespace would end up in the cells' text.
    const markup = svg.trim().replace(/>\s+</g, "><");
    node = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement as unknown as SVGElement;
    node.removeAttribute("width");
    node.removeAttribute("height");
    node.setAttribute("aria-hidden", "true");
    node.classList.add("w-icon");
    parsed.set(svg, node);
  }
  return node.cloneNode(true) as SVGElement;
}
