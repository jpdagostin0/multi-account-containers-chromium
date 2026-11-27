# Multi-Account Containers for Chromium (MV2)

A port of Mozilla's [Firefox Multi-Account Containers][upstream] to
Chromium browsers that still run Manifest V2 extensions, such as
[Helium](https://helium.computer). The upstream add-on is unchanged: the
same popup, options page, site assignments, locked containers, sync,
keyboard shortcuts and per-container proxies. A compatibility layer in
[`chrome/`](chrome) emulates what Chromium lacks.

Chromium has no `contextualIdentities` API, only one cookie jar per profile,
and no per-request proxy hook. The port emulates them:

| Firefox | This port |
| --- | --- |
| `contextualIdentities.*` | stored in `storage.local`; Personal / Work / Banking / Shopping are seeded on first run |
| `tab.cookieStoreId`, `tabs.create({cookieStoreId})` | tab-to-container map in the background page. Tabs opened from a container tab (links, `window.open`) inherit its container. Container tabs come back after a restart, because each page remembers its container in its own `sessionStorage`. |
| one cookie jar per container | cookies are renamed in the shared jar: `sid` set in container 3 is stored as `MACC3~sid`. Blocking `webRequest` filters and unprefixes `Cookie` and prefixes `Set-Cookie`. Chromium still handles domain, path, expiry, Secure, SameSite and HttpOnly. |
| per-container DOM storage | a main-world shim namespaces `document.cookie`, `cookieStore`, `localStorage`/`sessionStorage`, IndexedDB, Cache Storage and `BroadcastChannel` with the same prefix. "Delete container data" and container removal wipe only that container's entries. |
| per-container HTTP cache | a request bypasses the cache whenever another container holds cookies for that URL, so a response personalised for one container is never served to another |
| per-container service workers | the first container to use an origin owns its workers, and their traffic is attributed to that container. If a second container uses the origin, the workers are removed and registration is disabled there. |
| per-container proxies (`proxy.onRequest`) | a small local helper does the routing, see below |
| "Always open in" (reopens in a new tab) | the tab switches container in place when the navigation commits; the confirm page is still shown unless "remember my decision" was ticked |
| colored tab line | a line in the container's color on the left of the tab's icon, plus an optional page border, optional tab groups and a toolbar badge (see [Highlighting](#highlighting)) |

Pages learn their container synchronously from a `Server-Timing` response
header that the extension adds to every document, so the shim is in place
before any page script runs.

## Install

1. Download `multi-account-containers-chromium-*.zip` from
   [Releases](../../releases) and unzip it, or build it yourself (see below).
2. Open `chrome://extensions`, enable **Developer mode**, click **Load
   unpacked**, and select the unzipped folder (`dist/chromium` if you built it).
   The extension ID is pinned to `onhincpcieoahedkojoldccglpaokjln`.
3. Pin the toolbar button. <kbd>Ctrl</kbd>+<kbd>.</kbd> opens the panel. You can
   bind the per-container shortcuts at `chrome://extensions/shortcuts`.
4. Optional: to use containers in incognito windows, enable **Allow in
   Incognito** on the extension's details page.
5. Optional, only if you want tab groups instead of or as well as the favicon dot: load
   `multi-account-containers-chromium-tabgroups-*.zip` (or
   `dist/chromium-tabgroups`) unpacked as well.

Keep **Developer mode** on. Chromium disables unpacked extensions on restart
when it's off.

## Highlighting

Firefox draws a colored line on container tabs. Chromium doesn't let
extensions style tabs, so the port offers these instead, all switchable in the
extension's options:

- **Icon line** (on by default). The favicon of each container tab is
  redrawn with a line about 2px wide in the container's color down its left
  edge, with the site's icon beside it. It shows anywhere the browser
  draws the tab icon, horizontal or vertical tabs alike. If the page changes
  its own icon, the new one gets marked too. Pages without a usable icon get just the line.
- **Page border** (off by default). A thin frame in the container's color is
  drawn around container pages.
- **Tab groups** (off by default). Each container's tabs go into one tab group
  per window, named and colored after the container. Only Manifest V3
  extensions may color tab groups, so this needs the tiny companion extension
  in [`chrome/tabgroups-companion`](chrome/tabgroups-companion), loaded
  unpacked as well.
- **Toolbar badge** (always on). The badge shows the container's initial, in
  its color.

## Move site data to container

Right-click a page, or the toolbar button, and choose **Move this site's data
to container**, then pick a target, including **No container**. This moves
the site's data out of the tab's current container and reopens the tab in the
target container:

- **cookies:** every cookie for the site (its registrable domain and all
  subdomains)
- **page storage:** the tab's origin's localStorage, sessionStorage, IndexedDB
  (with schema, indexes and version) and Cache Storage

This is handy when you logged into something before you set up containers.
Where the target already has an entry with the same name, the moved entry
replaces it. Page storage of other origins on the same site, such as an
embedded login frame on a subdomain, isn't moved.

## New tab page

The extension replaces the new tab page. It shows your top sites grouped by
container, plus **No container**, with the tab's own container first.

- **Opening tiles:** clicking a tile opens it in that tile's container, even
  from a new tab in a different container. Ctrl- or middle-click opens it in a
  new background tab in that container.
- **Hiding tiles:** the × on a tile removes it from the list.
- **Search:** the search box uses your default search engine in the current
  tab.
- **How visits are counted:** Chromium's history is shared by all containers,
  so the extension counts visits per container itself. "No container" starts
  out seeded from Chromium's top sites.
- **History link:** the **History** link at the top right opens the
  per-container history.

## Per-container history

Chromium keeps one history for everything, so the extension also keeps its
own, with the container of every visit. That includes in-page navigations of
single-page apps.

- **Opening it:** use **History by container** in the toolbar button's
  right-click menu, or the **History** link on the new tab page.
- **Filtering and opening:** filter by container, including **No container**,
  and search titles and URLs. A click opens the page in the container it was
  visited in.
- **Removing entries:** delete single entries, or clear one container's
  history. Chromium's own history isn't touched.
- **Retention:** entries are kept for 90 days. Removing a container removes its
  history.
- **Favicons:** site icons are saved in the extension's database, one per
  origin, refreshed weekly and fetched without cookies. The new tab and
  history pages use them.

Chromium asks once whether to keep the changed new tab page; choose **Keep
it**.

## Per-container proxies

Set a proxy under a container's **Advanced proxy settings** in the panel,
exactly as in Firefox (`http://`, `https://`, `socks://` = SOCKS5, `socks4://`,
optionally `user:pass@`).

Chromium only allows one proxy configuration per browser, and PAC scripts
never see the tab, so routing happens in `macc-proxy-helper`. It's a small Go
program that the browser starts on demand through native messaging. Install
it once:

```sh
cd chrome/helper && ./install.sh     # needs Go; or use the release tarball
```

While any container has a proxy, the extension points the browser at the
helper and tags every connection with its container. The helper challenges
each new connection with `407`, and `webRequest.onAuthRequired`, which knows
the tab, answers with a one-time token for that container. The helper then
routes the connection through that container's upstream proxy, or connects
directly for containers without one. Tokens are single-use, so Chromium's
cached proxy credentials can't tag a connection with the wrong container.

The proxy setup fails closed:

- If the helper isn't running or another extension controls the proxy
  setting, tabs in proxied containers don't load. They show a page explaining
  why, and nothing falls back to a direct connection.
- Chromium pools connections per top-level site, not per tab. So the same site
  can't be open at the same time in two containers that reach the internet
  differently. The second one gets an explanation page with a button to close
  the other tabs. Old tunnels for a site are closed before it opens under a
  different route.
- While proxies are on, WebRTC is limited to proxied connections and DNS
  prefetching is turned off.

The options page shows the helper's status.

## Build

```sh
git clone --recursive https://github.com/jpdagostin0/multi-account-containers-chromium
cd multi-account-containers-chromium/chrome
npm install           # webextension-polyfill, tldts
node build.mjs --zip  # -> dist/chromium/, dist/chromium-tabgroups/, dist/*.zip
```

`build.mjs` copies `src/` as-is, injects the compat layer into every page,
adds the isolation and proxy modules to the background page, rewrites the
manifest for Chromium, and fixes up locale files that Firefox accepts but
Chromium refuses to load.

### Tests

```sh
node chrome/test/e2e.mjs      # BROWSER=chromium for another browser
```

This starts test servers, two upstream proxies and the helper, then drives a
headless browser over CDP. It checks cookie, storage, cache and service-worker
isolation in both directions, container inheritance, restore, strict-CSP
pages, per-container wipes, site assignment, container deletion, proxy
routing over HTTP and HTTPS, the same-site conflict guard, and fail-closed
behaviour without the helper.

## Remaining limits

These come from Chromium itself. An extension can't change them:

- HTTP authentication (Basic/Digest) is shared between containers. Chromium
  adds cached credentials below the extension layer, where `webRequest` can't
  see or strip them.
- A site can't be open in two containers at the same time if their proxies
  differ (see above). Containers with the same proxy, or no proxy, are
  unaffected.
- Saved passwords, history, and the fingerprint are shared. This is the same
  as in Firefox.
- Mozilla VPN and the bookmark context menu are Firefox-only, so they're
  hidden.

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
