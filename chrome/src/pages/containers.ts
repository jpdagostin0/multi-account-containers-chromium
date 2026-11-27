/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// The container list as extension pages show it: "No container" first.

import { DEFAULT, idOf } from "../lib/constants";
import { ff } from "../lib/ff";

export interface Container { n: number; csid: string; name: string; color: string | null; icon: string | null }

interface Identity { cookieStoreId: string; name: string; colorCode: string; iconUrl: string }

export async function listContainers(): Promise<Container[]> {
  const idents = await ff().contextualIdentities.query({}) as unknown as Identity[];
  return [
    { n: 0, csid: DEFAULT, name: "No container", color: null, icon: null },
    ...idents.map((i) => ({ n: idOf(i.cookieStoreId), csid: i.cookieStoreId, name: i.name, color: i.colorCode, icon: i.iconUrl })),
  ];
}

/** Hostname without www., for labels. */
export function hostLabel(url: string): string {
  return URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, "") : url;
}

/** One letter for a site without an icon. */
export const initial = (url: string) => (hostLabel(url).match(/[a-z0-9]/i) || ["•"])[0]!.toUpperCase();

/** Show a site icon in `el`, or its initial. */
export function showFavicon(el: HTMLElement, url: string, icon: string | null | undefined): void {
  if (icon) {
    el.style.backgroundImage = `url("${icon}")`;
  } else {
    el.classList.add("letter");
    el.textContent = initial(url);
  }
}

/** Middle click / modifier click opens a background tab in the container. */
export function openInBackground(url: string, csid: string, extra: Record<string, unknown> = {}): void {
  ff().tabs.create({ url, cookieStoreId: csid, active: false, ...extra });
}

/** A container's icon in its color (`null`: the "All containers" icon). Set `--c` on an ancestor for the color. */
export function identIcon(c: Container | null): HTMLSpanElement {
  const icon = document.createElement("span");
  icon.className = "ident-icon";
  const url = c ? c.icon : "/img/multiaccountcontainer-16.svg";
  if (url) icon.style.setProperty("--icon", `url("${url}")`);
  return icon;
}

/** The template's first element, cloned. */
export const cloneTemplate = <T extends HTMLElement = HTMLElement>(id: string): T =>
  (document.getElementById(id) as HTMLTemplateElement).content.firstElementChild!.cloneNode(true) as T;
