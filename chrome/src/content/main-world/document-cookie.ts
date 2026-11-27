/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// document.cookie -> `MACC<n>~` prefixed cookie names.

import { ANY, type Names } from "./names";
import { desc, type Realm } from "./realm";

export function patchDocumentCookie(win: Realm, { pre }: Names): void {
  const cookieDesc = desc(win.Document.prototype, "cookie");
  if (!cookieDesc) return;
  const filter = (raw: string) => {
    if (!raw) return raw;
    const out: string[] = [];
    for (const part of raw.split("; ")) {
      if (pre) {
        if (part.startsWith(pre)) {
          const rest = part.slice(pre.length);
          out.push(rest[0] === "=" ? rest.slice(1) : rest);
        }
      } else if (!ANY.test(part)) {
        out.push(part);
      }
    }
    return out.join("; ");
  };
  const prefix = (v: string) => {
    const semi = v.indexOf(";");
    const first = (semi < 0 ? v : v.slice(0, semi)).trimStart();
    const rest = semi < 0 ? "" : v.slice(semi);
    return pre + (first.includes("=") ? first : `=${first}`) + rest;
  };
  Object.defineProperty(win.Document.prototype, "cookie", {
    configurable: true,
    enumerable: cookieDesc.enumerable,
    get() { return filter(cookieDesc.get!.call(this)); },
    set(value) {
      const v = String(value);
      if (pre) cookieDesc.set!.call(this, prefix(v));
      else if (!ANY.test(v.trimStart())) cookieDesc.set!.call(this, v);
    },
  });
}
