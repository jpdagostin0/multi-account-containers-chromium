# Multi-Account Containers for Chromium (MV2)

A port of Mozilla's [Firefox Multi-Account Containers][upstream] to
Chromium browsers that still run Manifest V2 extensions, such as
[Helium](https://helium.computer). It keeps the upstream add-on unchanged
(same popup, options page, site assignments, locked containers, sync, and
keyboard shortcuts) and adds a compatibility layer in [`chrome/`](chrome)
that emulates what Chromium lacks.

Chromium has no `contextualIdentities` API and only one cookie jar per
profile. The port emulates containers on top of that jar:

| Firefox | This port |
| --- | --- |
| `contextualIdentities.*` | stored in `storage.local`; Personal / Work / Banking / Shopping seeded on first run |
| `tab.cookieStoreId`, `tabs.create({cookieStoreId})` | tab→container map in the background page; tabs opened from a container tab (links, `window.open`) inherit it |
| one cookie jar per container | cookies are renamed in the shared jar: `sid` set in container 3 is stored as `MACC3~sid`. Blocking `webRequest` filters and unprefixes the `Cookie` header, and prefixes `Set-Cookie`. Chromium still handles domain/path/expiry/Secure/SameSite/HttpOnly. |
| per-container DOM storage | a main-world shim namespaces `document.cookie`, `cookieStore`, `localStorage`/`sessionStorage`, IndexedDB, Cache Storage and `BroadcastChannel` with the same prefix. Default tabs never see prefixed entries. |
| "Always open in" (reopens in a new tab) | the tab switches container in place when the navigation commits; the confirm page is still shown unless "remember my decision" was ticked |
| colored tab line | a per-tab toolbar badge with the container's color and initial |

The page learns its container synchronously from a `Server-Timing: macc`
response header that the extension adds to every document, so the shim is in
place before any page script runs.

## Install

1. Download `multi-account-containers-chromium-*.zip` from
   [Releases](../../releases) and unzip it, or build it yourself (see below).
2. Open `chrome://extensions`, enable **Developer mode**, click **Load
   unpacked**, and select the unzipped folder (`dist/chromium` if you built it).
3. Pin the toolbar button. <kbd>Ctrl</kbd>+<kbd>.</kbd> opens the panel. You can
   bind the per-container shortcuts at `chrome://extensions/shortcuts`.

You need a browser that still loads MV2 extensions with `webRequestBlocking`
(Helium, ungoogled-chromium, Chromium with the MV2 flags, etc.).

## Build

```sh
git clone --recursive https://github.com/jpdagostin0/multi-account-containers-chromium
cd multi-account-containers-chromium/chrome
npm install           # webextension-polyfill
node build.mjs --zip  # -> dist/chromium/ and dist/*.zip
```

`build.mjs` copies `src/` as-is, injects `webextension-polyfill` and
`chrome/js/compat.js` into every page, adds the isolation engine to the
background page, rewrites the manifest for Chromium, and fixes up locale files
that Firefox accepts but Chromium refuses to load.

### Tests

```sh
python3 chrome/test/server.py 8765 &
BROWSER=helium node chrome/test/e2e.mjs
```

This runs a headless browser over CDP and checks cookie and storage isolation
in both directions, container inheritance, the strict-CSP case, site
assignment (the confirm page and the in-place switch), and container
deletion.

## Limits

This isolates accounts. It is not a security boundary:

- The HTTP cache is shared. Document and XHR/fetch requests in containers
  (and for sites ever opened in a container) are sent with
  `Cache-Control: no-cache` so they revalidate with the right cookies, but
  other cached subresources are shared.
- Service workers can't be attributed to a tab. Sites opened in a container
  get their workers removed, and worker registration is disabled for them.
- Clearing a container's site data clears that site's localStorage in every
  container, because Chromium can't target the prefix.
- HTTP auth, saved passwords, history, and the fingerprint are shared.
- Containers aren't available in incognito windows.
- Mozilla VPN / per-container proxies and the bookmark context menu are
  Firefox-only and are disabled.
- Tab restore after a browser restart matches tabs by URL, so it's
  best-effort.

## Upstream

`src/` tracks [mozilla/multi-account-containers][upstream]. To update, merge
upstream and rebuild. The port only adds files under `chrome/`. MPL-2.0, same
as upstream.

[upstream]: https://github.com/mozilla/multi-account-containers

---

# Multi-Account Containers (upstream README)

[![Test](https://github.com/mozilla/multi-account-containers/actions/workflows/test.yaml/badge.svg)](https://github.com/mozilla/multi-account-containers/actions/workflows/test.yaml)

The Firefox Multi-Account Containers extension lets you carve out a separate box for each of your online lives – no more opening a different browser just to check your work email!

Learn more about Multi-Account Containers in
[our end-user documentation][enduser].

## Contributing

Everyone is welcome to contribute to Multi-Account Containers. To learn how
to contribute a patch to Multi-Account Container, please
[read our contributing guide][contributing].

You can also chat with us on [our Matrix room][matrix] or ask in [our discussions board][discussions].

This repository is governed by Mozilla's code of conduct and etiquette
guidelines. For more details, [please read the Mozilla Community Participation Guidelines][cpg].

### License

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.

<!-- Please keep the list in alphabetical order -->
[contributing]: CONTRIBUTING.md
[cpg]: https://www.mozilla.org/about/governance/policies/participation/
[enduser]: https://support.mozilla.org/en-US/kb/containers
[forum]: https://discourse.mozilla.org/c/containers/223
[discussions]: https://github.com/mozilla/multi-account-containers/discussions
[matrix]: https://matrix.to/#/#containers:mozilla.org
