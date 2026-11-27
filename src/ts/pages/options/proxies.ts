/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// "Per-container proxies" status.

import type { ProxyApi } from "../../background/proxy";
import { installCommand } from "../install-command";
import { el } from "./dom";

function summary(s: ReturnType<ProxyApi["status"]>): string {
  const n = Object.keys(s.routes).length;
  if (!s.enabled) return "No container uses a proxy. Set one under a container's “Advanced proxy settings” in the toolbar panel.";
  if (s.helperRunning && s.applied) return `Active: helper ${s.version} is routing ${n} container(s).`;
  if (s.helperRunning) {
    return `The helper is running, but the browser proxy setting is controlled by something else (${s.control}). `
      + "Proxied containers are blocked until that is resolved.";
  }
  return `The proxy helper isn't running${s.error ? ` (${s.error})` : ""}. Proxied containers are blocked until it is. Install it with:`;
}

export function proxiesSection(proxy: ProxyApi) {
  const node = el("div", { id: "macc-proxy-status", className: "settings-group" });
  function render(): void {
    const s = proxy.status();
    node.replaceChildren(el("h3", { textContent: "Per-container proxies" }), el("p", { textContent: summary(s) }));
    if (s.enabled && !s.helperRunning) node.append(el("pre", { textContent: installCommand(s.extensionId) }));
  }
  return { node, render };
}
