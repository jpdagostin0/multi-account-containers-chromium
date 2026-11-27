/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Wallpaper, weather effects and the weather line, kept up to date with the
// settings page and the weather (refreshed every 15 minutes).

import type { Weather, WeatherApi, WeatherSettings } from "../../background/weather";
import { SKY_OF } from "../../background/weather/conditions";
import type { Wallpaper, WallpaperApi } from "../../background/wallpaper";
import { createScene, type SceneSpec } from "./scene";
import { renderWeather } from "./weather";

const REFRESH_MS = 15 * 60 * 1000;

function sceneSpec(wp: Wallpaper, s: WeatherSettings, w: Weather | null): SceneSpec | null {
  const hour = new Date().getHours();
  const isDay = w?.reading.isDay ?? (hour >= 7 && hour < 19);
  const effect = s.effects === "off" ? null : s.effects === "auto" ? w?.condition.effect ?? null : s.effects;
  const density = s.effects === "auto" ? w?.condition.density ?? 1 : 1;
  const sky = wp.kind !== "sky" ? null : s.effects === "auto" || s.effects === "off" ? w?.condition.sky ?? "clear" : SKY_OF[s.effects];
  return { effect, density, sky, isDay };
}

export function setUpAmbient(weather: WeatherApi, wallpaper: WallpaperApi): void {
  const root = document.documentElement;
  const image = document.getElementById("wallpaper")!;
  const dim = document.getElementById("wallpaper-dim")!;
  const scene = createScene(document.getElementById("scene") as HTMLCanvasElement);

  async function update(force = false): Promise<void> {
    const [wp, s] = await Promise.all([wallpaper.get(), weather.settings()]);
    let w: Weather | null = null, failed = false;
    if (s.place && (s.show || s.effects === "auto")) {
      try { w = await weather.current(force); } catch { failed = true; }
    }
    renderWeather(s, w, failed);
    image.hidden = wp.kind !== "image" || !wp.image;
    image.style.backgroundImage = image.hidden ? "" : `url(${JSON.stringify(wp.image)})`;
    // A backdrop filter over the wallpaper and the scene blurs both (mirrored at the edges, so they stay full).
    const on = wp.kind !== "none";
    dim.style.backgroundColor = `rgb(0 0 0 / ${on ? wp.dim : 0})`;
    dim.style.backdropFilter = on && wp.blur ? `blur(${wp.blur}px)` : "";
    root.classList.toggle("has-wallpaper", wp.kind !== "none");
    const spec = sceneSpec(wp, s, w);
    if (JSON.stringify(spec) !== JSON.stringify(scene.spec)) scene.set(spec);
    root.dataset.effect = scene.canvas.hidden ? "" : spec?.effect ?? "";
  }

  // The weather line opens the settings drawer at the weather section.
  document.getElementById("weather")!.addEventListener("click", () => {
    const drawer = document.getElementById("settings-drawer")!;
    if (!root.classList.contains("settings-open")) document.getElementById("settings-toggle")!.click();
    drawer.querySelector("#weather-settings")?.scrollIntoView({ block: "start" });
  });

  update();
  setInterval(() => update(), REFRESH_MS);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes[weather.storageKey] || changes[wallpaper.storageKey])) update();
  });
}
