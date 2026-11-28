# Multi-Account Containers for Chromium (MV2)

A port of Mozilla's [Firefox Multi-Account Containers][upstream] to
Chromium browsers that still run Manifest V2 extensions, such as
[Helium](https://helium.computer). It keeps upstream's popup, site
assignments, locked containers and keyboard shortcuts, and adds a new tab
page that holds per-container history, the weather and all settings. Per-container proxies,
Firefox Sync and the Mozilla VPN integration aren't included. The extension files derived from upstream live in
[`src/extension/`](src/extension), and a TypeScript compatibility layer in
[`src/ts/`](src/ts) emulates what Chromium lacks.

Chromium has no `contextualIdentities` API and only one cookie jar per
profile. The port emulates them:

| Firefox | This port |
| --- | --- |
| `contextualIdentities.*` | stored in `storage.local`; Personal / Work / Banking / Shopping are seeded on first run |
| `tab.cookieStoreId`, `tabs.create({cookieStoreId})` | tab-to-container map in the background page. Tabs opened from a container tab (links, `window.open`) inherit its container. Container tabs come back after a restart, because each page remembers its container in its own `sessionStorage`. |
| one cookie jar per container | cookies are renamed in the shared jar: `sid` set in container 3 is stored as `MACC3~sid`. Blocking `webRequest` filters and unprefixes `Cookie` and prefixes `Set-Cookie`. Chromium still handles domain, path, expiry, Secure, SameSite and HttpOnly. |
| per-container DOM storage | a main-world shim namespaces `document.cookie`, `cookieStore`, `localStorage`/`sessionStorage`, IndexedDB, Cache Storage and `BroadcastChannel` with the same prefix. "Delete container data" and container removal wipe only that container's entries. |
| per-container HTTP cache | a request bypasses the cache whenever another container holds cookies for that URL, so a response personalised for one container is never served to another |
| per-container service workers | the first container to use an origin owns its workers, and their traffic is attributed to that container. If a second container uses the origin, the workers are removed and registration is disabled there. |
| "Always open in" (reopens in a new tab) | the tab switches container in place when the navigation commits; the confirm page is still shown unless "remember my decision" was ticked |
| colored tab line | a toolbar badge, plus an optional page border and optional tab groups (see [Highlighting](#highlighting)) |

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
5. Optional, only if you want tab groups: load
   `multi-account-containers-chromium-tabgroups-*.zip` (or
   `dist/chromium-tabgroups`) unpacked as well.

Keep **Developer mode** on. Chromium disables unpacked extensions on restart
when it's off.

## Highlighting

Firefox draws a colored line on container tabs. Chromium doesn't let
extensions style tabs, so the port offers these instead, all switchable in the
settings:

- **Page border** (off by default). A thin frame in the container's color is
  drawn around container pages.
- **Tab groups** (off by default). Each container's tabs go into one tab group
  per window, named and colored after the container. Only Manifest V3
  extensions may color tab groups, so this needs the tiny companion extension
  in [`src/tabgroups-companion`](src/tabgroups-companion), loaded
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

## Settings

Settings live in a drawer on the new tab page (the **Settings** button at the
bottom left, under the container tabs). The extension's options open a new
tab with it open:

- **Search engine:** the new tab page's search box uses the browser's default
  engine, one of the common engines (DuckDuckGo, Google, Brave, Startpage,
  Kagi, Bing, Ecosia, Qwant), or your own: a search URL and an optional
  suggestions URL, with `%s` where the terms go. Chromium doesn't tell
  extensions which engine is the default, so the browser default has no
  suggestions.
- **Colors:** pages and the toolbar panel follow the system's light or dark
  mode, stay light or dark, or use custom background, surface and text colors.
  There are presets such as Catppuccin, Nord, Gruvbox and Tokyo Night.
- **Weather:** your location (the browser asks first) or a city or postal
  code, units, and the pixel art effects.
- **Wallpaper:** none, a pixel art sky that follows the weather and the time
  of day, or an image (a file or a web address), with dim and blur.
- **Highlighting, tabs, shortcuts:** the page border and tab group switches,
  whether "Always open in" replaces the tab, which container each keyboard
  shortcut opens, and the introduction.

## New tab page

The extension replaces the new tab page. It shows your top sites grouped by
container, plus **No container**, with the tab's own container first, each
group on its container's color.

- **Opening tiles:** clicking a tile opens it in that tile's container, even
  from a new tab in a different container. Ctrl- or middle-click opens it in a
  new background tab in that container.
- **Hiding tiles:** the × on a tile removes it from the list.
- **Search:** the search box uses the engine from the settings, in the
  tab's container. Suggestions come from the engine (fetched without cookies),
  your open tabs and this container's history.
- **How visits are counted:** Chromium's history is shared by all containers,
  so the extension counts visits per container itself, per site (origin)
  rather than per page: a tile opens the site's front page. "No container"
  starts out seeded from Chromium's top sites.
- **History:** the **History** button at the top right opens the
  per-container history drawer.
- **Weather:** the current weather from [Open-Meteo](https://open-meteo.com)
  sits over the search box; hover it for the next five hours and three days.
  Readings are kept for an hour. Rain, snow, storms, clouds, fog and clear
  nights play behind the page as pixel art
  ([pixelfx](https://github.com/patch-gg/pixelfx)).

## Per-container history

Chromium keeps one history for everything, so the extension also keeps its
own, with the container of every visit. That includes in-page navigations of
single-page apps.

- **Opening it:** use **History by container** in the toolbar button's
  right-click menu (a new tab with the drawer open at the tab's container), or
  the **History** button on the new tab page.
- **Filtering and opening:** filter by container, including **No container**,
  and search titles and URLs. A click opens the page in the container it was
  visited in.
- **Removing entries:** delete single entries, or clear one container's
  history. Chromium's own history isn't touched.
- **Retention:** entries are kept for 90 days. Removing a container removes its
  history.
- **Favicons:** site icons are saved in the extension's database, one per
  origin, refreshed weekly and fetched without cookies. The new tab page and
  its history drawer use them.

Chromium asks once whether to keep the changed new tab page; choose **Keep
it**.

## Build

```sh
git clone --recursive https://github.com/jpdagostin0/multi-account-containers-chromium
cd multi-account-containers-chromium/src
npm install           # webextension-polyfill, tldts
node build.mjs --zip  # -> dist/chromium/, dist/chromium-tabgroups/, dist/*.zip
```

`build.mjs` copies `extension/`, bundles `ts/` with esbuild, injects the compat layer into every page,
adds the isolation, history and search modules to the background page, rewrites the
manifest for Chromium, and fixes up locale files that Firefox accepts but
Chromium refuses to load.

### Tests

```sh
node src/test/e2e.mjs      # BROWSER=chromium for another browser
```

This starts a test server, then drives a headless browser over CDP. It checks
cookie, storage, cache and service-worker isolation in both directions,
container inheritance, restore, strict-CSP pages, per-container wipes, site
assignment, container deletion, the new tab page, search, history, weather,
wallpaper and settings.

## Remaining limits

These come from Chromium itself. An extension can't change them:

- HTTP authentication (Basic/Digest) is shared between containers. Chromium
  adds cached credentials below the extension layer, where `webRequest` can't
  see or strip them.
- Saved passwords, history, and the fingerprint are shared. This is the same
  as in Firefox.
- The bookmark context menu is Firefox-only, so it's hidden.
- Per-container proxies aren't supported. Chromium has one proxy setting per
  browser, and doing it per container needs a native program outside the
  extension.

## Upstream

Derived from [mozilla/multi-account-containers][upstream] 8.4.1; the
Firefox-only tooling, tests and branding were dropped, and upstream changes
are now merged by hand into `src/extension/`. MPL-2.0, same as upstream.

[upstream]: https://github.com/mozilla/multi-account-containers
