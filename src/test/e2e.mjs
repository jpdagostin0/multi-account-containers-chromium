// End-to-end test of the Chromium port against headless Helium/Chromium.
//
//   node src/test/e2e.mjs        (BROWSER=chromium to use another browser)
//
// Starts its own test server.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, extDir, sleep } from "./cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT_ID = "onhincpcieoahedkojoldccglpaokjln";
const COMPANION_ID = "jeedhomnaldfldmfkfekpifefpfcpbll";
const ORIGIN = "http://127.0.0.1:8765";
const ALT = "http://localhost:8765";

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ""}`);
};

const children = [];
const py = (...args) => {
  const p = spawn("python3", args, { stdio: "ignore" });
  children.push(p);
  return p;
};
py(path.join(here, "server.py"), "8765", "127.0.0.1");

await sleep(1500);

async function session(c, { withErrors = true } = {}) {
  const { id } = await c.send("Extensions.loadUnpacked", { path: extDir });
  check("extension id pinned by manifest key", id === EXT_ID, id);
  const { id: cid } = await c.send("Extensions.loadUnpacked", { path: path.resolve(extDir, "..", "chromium-tabgroups") });
  check("tab group companion id pinned", cid === COMPANION_ID, cid);
  await sleep(1500);
  const bgT = (await c.targets()).find((t) => t.url === `chrome-extension://${id}/js/background/index.html`);
  const bg = await c.attach(bgT.targetId);
  const errors = [];
  if (withErrors) {
    c.on((m) => {
      if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    });
  }
  await c.send("Runtime.enable", {}, bg);
  const B = (expr) => c.evaluate(bg, expr);
  const settle = async (min = 300) => {
    await sleep(min);
    for (let i = 0; i < 100; i++) {
      if (!(await B("browser.tabs.query({}).then(l => l.some(t => t.status !== 'complete'))"))) return;
      await sleep(100);
    }
  };
  const pageSession = async (urlPart) => {
    let t;
    for (let i = 0; i < 50 && !t; i++) {
      // The settings tab (newtab.html#settings) stays open; only find it by name.
      t = (await c.targets()).find((x) => x.type === "page" && x.url.includes(urlPart) && (urlPart.includes("#") || !x.url.includes("#")));
      if (!t) await sleep(100);
    }
    if (!t) throw new Error(`no page ${urlPart}: ${(await c.targets()).map((x) => x.url).join(", ")}`);
    await settle();
    const s = await c.attach(t.targetId);
    await c.send("Runtime.enable", {}, s);
    return s;
  };
  const P = (s, e) => c.evaluate(s, e);
  const echo = (s, url = "/echo") => P(s, `fetch('${url}').then(r => r.json())`).then((j) => j.cookie);
  return { id, bg, B, settle, pageSession, P, echo, errors };
}

// ---------------------------------------------------------------------------
// isolation
// ---------------------------------------------------------------------------
{
  const c = await launch();
  let errors = [];
  try {
    const { id: extId, bg, B, settle, pageSession, P, echo, errors: errs } = await session(c);
    errors = errs;

    const idents = await B("browser.contextualIdentities.query({}).then(l => l.map(i => i.cookieStoreId + ':' + i.name))");
    check("default containers seeded", idents.length === 4, idents);

    const workTab = await B(`browser.tabs.create({cookieStoreId: "firefox-container-2", url: "${ORIGIN}/set?n=sid&v=work"}).then(t => t.id)`);
    await settle();
    const defTab = await B(`browser.tabs.create({url: "${ORIGIN}/set?n=sid&v=default"}).then(t => t.id)`);
    await settle();
    check("tabs.get reports cookieStoreId", (await B(`browser.tabs.get(${workTab}).then(t => t.cookieStoreId)`)) === "firefox-container-2");
    check("tabs.query filters by cookieStoreId",
      JSON.stringify(await B(`browser.tabs.query({cookieStoreId: "firefox-container-2"}).then(l => l.map(t => t.id))`)) === JSON.stringify([workTab]));

    let work = await pageSession("v=work");
    const def = await pageSession("v=default");

    check("container request cookies", (await echo(work)) === "sid=work; http_sid=work", await echo(work));
    check("default request cookies", (await echo(def)) === "sid=default; http_sid=default", await echo(def));
    check("container document.cookie", (await P(work, "document.cookie")) === "sid=work", await P(work, "document.cookie"));
    check("default document.cookie", (await P(def, "document.cookie")) === "sid=default", await P(def, "document.cookie"));
    const timing = () => P(work, "performance.getEntriesByType('navigation')[0].serverTiming.find(e => e.name === 'macc').description");
    check("Server-Timing marker (container owns its workers)", (await timing()) === "2", await timing());

    await P(work, "document.cookie = 'js=fromwork; path=/'");
    check("container JS-set cookie reaches server", (await echo(work)).includes("js=fromwork"), await echo(work));
    check("container JS-set cookie hidden from default", !(await echo(def)).includes("js=") && !(await P(def, "document.cookie")).includes("js="));

    const jar = await B("browser.cookies.getAll({}).then(l => l.map(c => c.name).sort())");
    check("jar stores prefixed names", jar.includes("MACC2~sid") && jar.includes("MACC2~http_sid") && jar.includes("sid"), jar);

    await P(work, "localStorage.setItem('k', 'work'); localStorage.other = 'x'");
    await P(def, "localStorage.setItem('k', 'default')");
    const lsWork = "JSON.stringify([localStorage.getItem('k'), localStorage.length, Object.keys(localStorage).sort()])";
    check("localStorage isolated (container)", (await P(work, lsWork)) === JSON.stringify(["work", 2, ["k", "other"]]), await P(work, lsWork));
    check("localStorage isolated (default)", (await P(def, "JSON.stringify([localStorage.k, localStorage.length])")) === JSON.stringify(["default", 1]),
      await P(def, "JSON.stringify([localStorage.k, localStorage.length])"));

    await P(work, "new Promise(r => { const q = indexedDB.open('db1'); q.onsuccess = () => { q.result.close(); r(); }; })");
    const dbs = await P(def, "indexedDB.databases().then(l => l.map(d => d.name))");
    check("IndexedDB hidden from default", !dbs.length, dbs);
    check("IndexedDB visible in container", JSON.stringify(await P(work, "indexedDB.databases().then(l => l.map(d => d.name))")) === '["db1"]');

    const cs = await P(work, "cookieStore.getAll().then(l => l.map(c => c.name).sort())");
    check("cookieStore filtered", JSON.stringify(cs) === JSON.stringify(["js", "sid"]), cs);

    // Highlighting: tab icons are left alone; page border + tab groups are opt-in.
    await sleep(500);
    const tabIcon = await B(`browser.tabs.get(${workTab}).then(t => t.favIconUrl || "")`);
    check("container tab keeps the site's own icon", tabIcon.startsWith("http"), tabIcon.slice(0, 60));
    check("tab groups off by default", (await B(`browser.tabs.get(${workTab}).then(t => t.groupId)`)) === -1);
    await B("__maccHighlight.setSettings({tabGroups: true, pageBorder: true})");
    await B("__maccHighlight.syncAll()");
    await sleep(500);
    const frameColor = (s) => P(s, "(document.querySelector('macc-container-frame') || {dataset: {}}).dataset.color || null");
    check("container page has a border in its color", (await frameColor(work)) === "#ff9f00", await frameColor(work));
    check("default page has no border", (await frameColor(def)) === null, await frameColor(def));
    await c.send("Emulation.setDeviceMetricsOverride", { width: 800, height: 500, deviceScaleFactor: 1, mobile: false }, work);
    const borderShot = await c.send("Page.captureScreenshot", { format: "png" }, work);
    fs.writeFileSync((process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png")).replace(/\.png$/, "-border.png"), Buffer.from(borderShot.data, "base64"));
    const gid = await B(`browser.tabs.get(${workTab}).then(t => t.groupId)`);
    const group = gid >= 0 ? await B(`new Promise(r => chrome.runtime.sendMessage("${COMPANION_ID}", {op: "get", groupId: ${gid}}, r)).then(x => x.group)`) : null;
    check("container tab is in a tab group named and colored after it", group && group.title === "Work" && group.color === "orange", group);
    check("default tab is not grouped", (await B(`browser.tabs.get(${defTab}).then(t => t.groupId)`)) === -1);
    await B(`browser.contextualIdentities.update("firefox-container-2", {name: "Work!", color: "purple"})`);
    await sleep(500);
    const group2 = await B(`new Promise(r => chrome.runtime.sendMessage("${COMPANION_ID}", {op: "get", groupId: ${gid}}, r)).then(x => x.group)`);
    check("renaming/recoloring a container restyles its group", group2.title === "Work!" && group2.color === "purple", group2);
    check("…and its page border", (await frameColor(work)) === "#af51f5", await frameColor(work));
    await B(`browser.contextualIdentities.update("firefox-container-2", {name: "Work", color: "orange"})`);
    await B("__maccHighlight.setSettings({pageBorder: false, tabGroups: false})");
    await sleep(800);
    check("page border can be turned off", (await frameColor(work)) === null);
    check("turning tab groups off ungroups", (await B(`browser.tabs.get(${workTab}).then(t => t.groupId)`)) === -1);

    // HTTP cache: a personalised, cacheable response must not cross containers.
    const cachedWork = await P(work, "fetch('/cached').then(r => r.text())");
    const cachedDef = await P(def, "fetch('/cached').then(r => r.text())");
    check("HTTP cache not shared across containers", cachedWork.startsWith("sid=work") && cachedDef.startsWith("sid=default"), [cachedWork, cachedDef]);

    // Service workers: a second container using the origin takes them away.
    await B(`browser.tabs.reload(${workTab})`);
    await settle();
    work = await pageSession("v=work");
    check("origin shared by two containers: workers blocked", (await timing()) === "2|b", await timing());
    const sw = await P(work, "navigator.serviceWorker.register('/sw.js').then(() => 'ok', e => e.message)");
    check("SW registration refused", sw.includes("disabled"), sw);

    // Per-container storage wipe ("delete container data").
    await B(`browser.browsingData.removeLocalStorage({cookieStoreId: "firefox-container-2"})`);
    await sleep(800);
    check("container storage wiped in open tab", (await P(work, "localStorage.length")) === 0, await P(work, lsWork));
    check("default storage untouched", (await P(def, "localStorage.k")) === "default");
    await P(work, "localStorage.setItem('after', '1')");
    await B(`browser.tabs.reload(${workTab})`);
    await settle();
    work = await pageSession("v=work");
    check("wipe applies once per origin", (await P(work, "localStorage.getItem('after')")) === "1", await P(work, lsWork));

    // Inheritance: window.open from a container tab.
    await P(work, `void window.open('${ORIGIN}/page?child=1', '_blank')`);
    await settle();
    const child = await B(`browser.tabs.query({}).then(l => l.filter(t => t.url.includes('child=1')).map(t => [t.id, t.cookieStoreId]))`);
    check("window.open inherits container", child[0] && child[0][1] === "firefox-container-2", child);
    const childS = await pageSession("child=1");
    check("child tab cookies", (await echo(childS)).startsWith("sid=work"), await echo(childS));

    // Session restore: a tab the background doesn't know comes back from its
    // own sessionStorage marker.
    await B(`__maccIso.debug.forgetTab(${child[0][0]})`);
    check("forgotten tab looks like default", (await B(`browser.tabs.get(${child[0][0]}).then(t => t.cookieStoreId)`)) === "firefox-default");
    await B(`browser.tabs.reload(${child[0][0]})`);
    await settle(1500);
    await settle();
    check("restored tab recovers its container", (await B(`browser.tabs.get(${child[0][0]}).then(t => t.cookieStoreId)`)) === "firefox-container-2");
    const restored = await pageSession("child=1");
    check("restored tab cookies", (await echo(restored)).startsWith("sid=work"), await echo(restored));

    // CSP page in a container tab: shim must still apply.
    await B(`browser.tabs.update(${workTab}, {url: "${ORIGIN}/csp"})`);
    await settle();
    const cspS = await pageSession("/csp");
    const cspCookie = await P(cspS, "document.cookie");
    check("shim runs under strict CSP", cspCookie.split("; ").sort().join("; ") === "js=fromwork; sid=work", cspCookie);

    // Site assignment: confirm page, then neverAsk switching in place.
    await B(`browser.storage.local.set({"siteContainerMap@@_localhost8765": {userContextId: "3", neverAsk: false}})`);
    await B(`browser.tabs.update(${defTab}, {url: "${ALT}/set?n=sid&v=bank"})`);
    await settle();
    const confirmUrl = await B(`browser.tabs.get(${defTab}).then(t => t.url)`);
    check("assigned site shows confirm page", confirmUrl.startsWith(`chrome-extension://${extId}/confirm-page.html`), confirmUrl);

    await B(`browser.storage.local.set({"siteContainerMap@@_localhost8765": {userContextId: "3", neverAsk: true}})`);
    await B(`browser.tabs.update(${defTab}, {url: "${ALT}/set?n=sid&v=bank"})`);
    await settle();
    check("neverAsk assignment switches tab container",
      (await B(`browser.tabs.get(${defTab}).then(t => t.cookieStoreId)`)) === "firefox-container-3");
    const bank = await pageSession("v=bank");
    check("assigned container cookies", (await echo(bank)) === "sid=bank; http_sid=bank", await echo(bank));
    check("assigned page document.cookie", (await P(bank, "document.cookie")) === "sid=bank", await P(bank, "document.cookie"));

    // Container lifecycle.
    const created = await B(`browser.contextualIdentities.create({name: "Test", color: "red", icon: "gift"})`);
    check("create container", created.cookieStoreId === "firefox-container-5", created);
    await B(`browser.contextualIdentities.remove("firefox-container-3")`);
    await settle();
    check("removing a container closes its tabs",
      (await B(`browser.tabs.query({}).then(l => l.some(t => t.id === ${defTab}))`)) === false);
    const jar2 = await B("browser.cookies.getAll({}).then(l => l.map(c => c.name))");
    check("removing a container purges its cookies", !jar2.some((n) => n.startsWith("MACC3~")), jar2);

    // -------------------------------------------------------------------------
    // move site data between containers
    // -------------------------------------------------------------------------
    const mvTab = await B(`browser.tabs.create({url: "${ORIGIN}/set?n=mv&v=src"}).then(t => t.id)`);
    const mv = await pageSession("n=mv&v=src");
    await P(mv, `localStorage.setItem("mvkey", "moved"); new Promise(r => { const o = indexedDB.open("mvdb", 3);
      o.onupgradeneeded = () => o.result.createObjectStore("s", {keyPath: "id"}).createIndex("by", "v");
      o.onsuccess = () => { const tx = o.result.transaction("s", "readwrite"); tx.objectStore("s").put({id: 1, v: "row"}); tx.oncomplete = () => { o.result.close(); r(); }; }; })`);
    await P(mv, `caches.open("mvcache").then(c => c.put("/x", new Response("cached-body")))`);
    const res = await B(`__maccMoveData.moveSiteData(${mvTab}, "firefox-container-4")`);
    check("move reports what it moved", res.cookies >= 2 && res.localStorage >= 1 && res.indexedDB === 1 && res.caches === 1, res);
    await settle();
    check("moved tab is now in the target container", (await B(`browser.tabs.get(${mvTab}).then(t => t.cookieStoreId)`)) === "firefox-container-4");
    const mv2 = await pageSession("n=mv&v=src");
    const mvCookies = await echo(mv2);
    check("moved cookies arrive in the target container", mvCookies.includes("mv=src") && mvCookies.includes("http_mv=src"), mvCookies);
    check("moved localStorage", (await P(mv2, "localStorage.getItem('mvkey')")) === "moved");
    const row = await P(mv2, `new Promise(r => { const o = indexedDB.open("mvdb"); o.onsuccess = () => { const db = o.result;
      const q = db.transaction("s").objectStore("s").index("by").get("row"); q.onsuccess = () => r([db.version, q.result && q.result.id]); }; })`);
    check("moved IndexedDB (schema, index, version, rows)", JSON.stringify(row) === "[3,1]", row);
    check("moved Cache Storage", (await P(mv2, `caches.match("/x").then(r => r ? r.text() : null)`)) === "cached-body");
    const leftTab = await B(`browser.tabs.create({url: "${ORIGIN}/page?left=1"}).then(t => t.id)`);
    const left = await pageSession("left=1");
    const leftCookies = await echo(left);
    check("source container no longer has the data", !leftCookies.includes("mv=") && (await P(left, "localStorage.getItem('mvkey')")) === null
      && (await P(left, "indexedDB.databases().then(l => l.some(d => d.name === 'mvdb'))")) === false, leftCookies);
    await B(`browser.tabs.remove([${mvTab}, ${leftTab}])`);

    // -------------------------------------------------------------------------
    // new tab page: top sites per container
    // -------------------------------------------------------------------------
    const ntpTab = await B(`browser.tabs.create({}).then(t => t.id)`);
    const ntp = await pageSession("newtab");
    await sleep(500);
    const ntpSections = await P(ntp, `[...document.querySelectorAll("section")].map(s => [s.querySelector(".name").textContent, [...s.querySelectorAll(".tile a")].map(a => a.href)])`);
    const work2 = ntpSections.find(([n]) => n === "Work");
    check("new tab page lists top sites per container", ntpSections[0][0] === "No container" && work2 && work2[1].includes(`${ORIGIN}/`), ntpSections);
    check("top sites are ranked per site, not per page", ntpSections.every(([, urls]) => urls.every((u) => new URL(u).pathname === "/") && new Set(urls).size === urls.length), ntpSections);
    const tileLook = await P(ntp, `(() => { const a = document.querySelector(".tile a"); return [getComputedStyle(a).borderRadius, getComputedStyle(a, "::before").content, getComputedStyle(document.getElementById("q")).borderRadius]; })()`);
    check("new tab tiles are square with no color bar", tileLook[0] === "0px" && tileLook[1] === "none" && tileLook[2] === "0px", tileLook);
    check("tab URL looks like Firefox's new tab to upstream", (await B(`browser.tabs.get(${ntpTab}).then(t => t.url)`)) === "about:newtab");
    await P(ntp, `document.querySelector('section[data-container="firefox-container-2"] .tile a').click()`);
    await settle();
    check("clicking a container's tile opens it in that container", (await B(`browser.tabs.get(${ntpTab}).then(t => [t.cookieStoreId, t.url.startsWith("${ORIGIN}")].join())`)) === "firefox-container-2,true");
    const ntpWork = await B(`browser.tabs.create({cookieStoreId: "firefox-container-2"}).then(t => t.id)`);
    await settle();
    const ntpW = (await c.targets()).filter((t) => t.url.includes("newtab")).pop();
    const ntpWs = await c.attach(ntpW.targetId);
    await sleep(500);
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 750, deviceScaleFactor: 1, mobile: false }, ntpWs);
    await sleep(300);
    const ntpShot = await c.send("Page.captureScreenshot", { format: "png" }, ntpWs);
    fs.writeFileSync((process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png")).replace(/\.png$/, "-newtab.png"), Buffer.from(ntpShot.data, "base64"));
    check("container new tab puts its own container first", (await P(ntpWs, `document.querySelector("section.current .name").textContent`)) === "Work");
    // history drawer
    await P(ntpWs, `document.getElementById("history-toggle").click()`);
    await sleep(700);
    const drawer = await P(ntpWs, `(() => { const d = document.getElementById("history-drawer").getBoundingClientRect();
      const m = document.querySelector("main").getBoundingClientRect();
      return { left: d.left, width: d.width, mainRight: m.right, picker: document.querySelector(".picker-button .name").textContent,
        badges: [...document.querySelectorAll("#history-drawer .row .title")].length }; })()`);
    check("history drawer slides in at ~30% width beside the shrunk page", drawer.width >= 330 && drawer.width <= 345 && drawer.left + drawer.width <= 1101
      && drawer.mainRight <= drawer.left + 1 && drawer.picker === "Work" && drawer.badges > 0, drawer);
    const drawerShot = await c.send("Page.captureScreenshot", { format: "png" }, ntpWs);
    fs.writeFileSync((process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png")).replace(/\.png$/, "-drawer.png"), Buffer.from(drawerShot.data, "base64"));
    await P(ntpWs, `document.querySelector(".picker-button").click()`);
    await sleep(300);
    const pickerShot = await c.send("Page.captureScreenshot", { format: "png" }, ntpWs);
    fs.writeFileSync((process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png")).replace(/\.png$/, "-picker.png"), Buffer.from(pickerShot.data, "base64"));
    await P(ntpWs, `document.querySelector('.picker-list li[data-n="all"]').click()`);
    await sleep(500);
    const allBadges = await P(ntpWs, `[...new Set([...document.querySelectorAll("#history-drawer .row .badge")].map(b => b.textContent))]`);
    check("history drawer dropdown switches to all containers", allBadges.length > 1 && allBadges.includes("Work"), allBadges);
    await P(ntpWs, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await sleep(600);
    check("Escape closes the history drawer", (await P(ntpWs, `getComputedStyle(document.getElementById("history-drawer")).visibility`)) === "hidden");
    // container tabs: switch this new tab to another container
    const ctabs = await P(ntpWs, `[...document.querySelectorAll("#container-tabs button")].map(b => [b.textContent, b.getAttribute("aria-current")])`);
    check("container tabs list every container, current one marked", ctabs.length === 5 && ctabs.find(([n]) => n === "Work")[1] === "true", ctabs);
    await P(ntpWs, `[...document.querySelectorAll("#container-tabs button")].find(b => b.textContent === "Personal").click()`);
    await sleep(1200);
    const switched = await B(`browser.tabs.get(${ntpWork}).then(t => t.cookieStoreId)`);
    const nowCurrent = await P(ntpWs, `document.querySelector("section.current .name")?.textContent`);
    check("container tab switches this new tab's container", switched === "firefox-container-1" && nowCurrent === "Personal", [switched, nowCurrent]);

    // Search suggestions: the default engine, open tabs, this container's history.
    const visited = await B(`browser.tabs.create({cookieStoreId: "firefox-container-2", url: "${ORIGIN}/page?visited-once=1"}).then(t => t.id)`);
    await settle();
    await B(`browser.tabs.remove(${visited})`);
    await B(`__maccSearch.setEngine({name: "Test Engine", url: "${ORIGIN}/search?q=%s", suggestionsUrl: "${ORIGIN}/suggest?q=%s"})`);
    const sTab = await B(`browser.tabs.create({cookieStoreId: "firefox-container-2"}).then(t => t.id)`);
    await settle();
    const sT = (await c.targets()).filter((t) => t.url.includes("newtab")).pop();
    const sNtp = await c.attach(sT.targetId);
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 750, deviceScaleFactor: 1, mobile: false }, sNtp);
    await sleep(800);
    check("search box names the chosen engine", (await P(sNtp, `document.getElementById("q").placeholder`)) === "Search Test Engine in Work",
      await P(sNtp, `document.getElementById("q").placeholder`));
    await P(sNtp, `(() => { const q = document.getElementById("q"); q.focus(); q.value = "macc"; q.dispatchEvent(new Event("input")); })()`);
    await sleep(1500);
    const sugg = await P(sNtp, `[...document.querySelectorAll("#suggest li")].map(li => [li.dataset.kind, li.querySelector(".s-text").textContent])`);
    const kinds = new Set(sugg.map(([k]) => k));
    check("suggestions include the engine's", sugg.some(([k, t]) => k === "search" && t === "macc alpha"), sugg);
    check("engine suggestions are fetched without cookies", sugg.some(([, t]) => t === "cookie:no"), sugg);
    check("suggestions include open tabs", kinds.has("tab"), sugg);
    await P(sNtp, `(() => { const q = document.getElementById("q"); q.value = "visited-once"; q.dispatchEvent(new Event("input")); })()`);
    await sleep(1200);
    const fromHistory = await P(sNtp, `[...document.querySelectorAll('#suggest li[data-kind="history"] .s-sub')].map(e => e.textContent)`);
    check("suggestions include this container's history", fromHistory.some((u) => u.includes("visited-once=1")), fromHistory);
    await P(sNtp, `(() => { const q = document.getElementById("q"); q.value = "macc"; q.dispatchEvent(new Event("input")); })()`);
    await sleep(1200);
    fs.writeFileSync((process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png")).replace(/\.png$/, "-suggest.png"),
      Buffer.from((await c.send("Page.captureScreenshot", { format: "png" }, sNtp)).data, "base64"));
    const key = (k) => P(sNtp, `document.getElementById("q").dispatchEvent(new KeyboardEvent("keydown", { key: "${k}", bubbles: true, cancelable: true }))`);
    await key("ArrowDown");
    await key("ArrowDown");
    check("arrow keys put the suggestion in the box", (await P(sNtp, `document.getElementById("q").value`)) === "macc alpha");
    const target = await P(sNtp, `(() => { const li = document.querySelector('#suggest li[data-kind="tab"]'); li.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); return true; })()`);
    await sleep(800);
    check("picking an open tab switches to it and closes the new tab", target && (await B(`browser.tabs.get(${sTab}).then(() => "open", () => "closed")`)) === "closed");
    // Another engine (as picked in the settings page) takes over.
    await B(`__maccSearch.setEngine({name: "Mine", url: "${ORIGIN}/search?q={searchTerms}"})`);
    const cTab = await B(`browser.tabs.create({cookieStoreId: "firefox-container-2"}).then(t => t.id)`);
    await settle();
    let cNtp = null;
    for (const t of (await c.targets()).filter((x) => x.url.includes("newtab"))) {
      const sess = await c.attach(t.targetId);
      if ((await P(sess, "new Promise(r => chrome.tabs.getCurrent(t => r(t && t.id)))")) === cTab) cNtp = sess;
    }
    await sleep(800);
    const cHolder = await P(cNtp, `document.getElementById("q").placeholder`);
    check("changed search engine is used", cHolder === "Search Mine in Work", cHolder);
    await P(cNtp, `(() => { const q = document.getElementById("q"); q.value = "hello there"; document.getElementById("search").requestSubmit(); })()`);
    await settle();
    const cUrl = await B(`browser.tabs.get(${cTab}).then(t => [t.url, t.cookieStoreId].join(" "))`);
    check("searching opens the engine in the tab's container", cUrl === `${ORIGIN}/search?q=hello%20there firefox-container-2`, cUrl);
    await B(`__maccSearch.setEngine(null).then(() => browser.tabs.remove(${cTab}))`);
    const dTab = await B(`browser.tabs.create({cookieStoreId: "firefox-container-2"}).then(t => t.id)`);
    await settle();
    const dNtp = await pageSession("newtab");
    await sleep(500);
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 800, deviceScaleFactor: 1, mobile: false }, dNtp);
    const gear = await P(dNtp, `(() => { const r = document.getElementById("settings-toggle").getBoundingClientRect(); return [r.left < 40, innerHeight - r.bottom < 40]; })()`);
    check("settings button at the bottom left of the new tab page", gear.every(Boolean), gear);
    await P(dNtp, `document.getElementById("settings-toggle").click()`);
    await sleep(700);
    const sd = await P(dNtp, `(() => { const d = document.getElementById("settings-drawer").getBoundingClientRect(), t = document.getElementById("container-tabs");
      return [Math.round(d.left), Math.round(d.width / innerWidth * 100), getComputedStyle(document.querySelector("main")).transform !== "none",
        [...document.querySelectorAll("#settings-drawer .card h2")].map(h => h.textContent).join("|"),
        t.getBoundingClientRect().bottom <= d.top && getComputedStyle(t).opacity === "1" && document.elementFromPoint(t.getBoundingClientRect().left + 5, t.getBoundingClientRect().top + 5)?.closest("#container-tabs") !== null]; })()`);
    check("settings drawer slides in from the left at about 30% width, page shrinks", sd[0] === 0 && sd[1] >= 28 && sd[1] <= 32 && sd[2]
      && sd[3] === "Search engine|Colors|Weather|Wallpaper|Container highlighting|Tabs|Keyboard shortcuts|Introduction", sd);
    check("settings drawer sits under the container tabs, which stay usable", sd[4] === true, sd);
    fs.writeFileSync((process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png")).replace(/\.png$/, "-settings-drawer.png"),
      Buffer.from((await c.send("Page.captureScreenshot", { format: "png" }, dNtp)).data, "base64"));
    await P(dNtp, `document.getElementById("history-toggle").click()`);
    await sleep(600);
    check("opening history closes the settings drawer", await P(dNtp, `(() => { const r = document.documentElement.classList; return r.contains("history-open") && !r.contains("settings-open"); })()`));
    await P(dNtp, `document.getElementById("settings-toggle").click()`);
    await sleep(100);
    await P(dNtp, `dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
    await sleep(100);
    check("Escape closes the settings drawer", await P(dNtp, `!document.documentElement.className.includes("-open")`));
    check("browser default engine: generic placeholder", (await P(dNtp, `document.getElementById("q").placeholder`)) === "Search the web in Work");
    await B(`browser.tabs.remove(${dTab})`);
    const tabsShot = await c.send("Page.captureScreenshot", { format: "png" }, ntpWs);
    fs.writeFileSync((process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png")).replace(/\.png$/, "-ctabs.png"), Buffer.from(tabsShot.data, "base64"));
    await B(`browser.tabs.remove(${ntpWork})`);

    // -------------------------------------------------------------------------
    // per-container history + saved favicons
    // -------------------------------------------------------------------------
    const hq = (q) => B(`__maccHistory.query(${JSON.stringify(q)}).then(l => l.map(v => [v.n, v.url, v.title, !!v.icon]))`);
    const h2 = await hq({ n: 2 });
    check("history records container visits", h2.some(([n, u]) => n === 2 && u === `${ORIGIN}/set?n=sid&v=work`), h2.slice(0, 5));
    check("history keeps no-container visits separately", (await hq({ n: 0 })).some(([, u]) => u === `${ORIGIN}/set?n=sid&v=default`)
      && !h2.some(([, u]) => u === `${ORIGIN}/set?n=sid&v=default`));
    check("removed container's history is gone", (await hq({ n: 3 })).length === 0 && !(await hq({})).some(([n]) => n === 3));
    check("history entries carry titles and saved icons", h2.some(([, , t, i]) => t === "macc test" && i), h2.slice(0, 3));
    const spaTab = await B(`browser.tabs.create({cookieStoreId: "firefox-container-2", url: "${ORIGIN}/page?spa=0"}).then(t => t.id)`);
    const spa = await pageSession("spa=0");
    await P(spa, "history.pushState({}, '', '/page?spa=1')");
    await sleep(500);
    check("single-page-app navigations are recorded", (await hq({ n: 2, text: "spa=1" })).length === 1);
    check("history search", (await hq({ n: 2, text: "csp" })).every(([, u]) => u.includes("csp")) && (await hq({ n: 2, text: "csp" })).length > 0);
    const icon = await B(`__maccHistory.iconsFor(["${ORIGIN}"]).then(x => x["${ORIGIN}"] || null)`);
    check("favicon saved for the site", typeof icon === "string" && icon.startsWith("data:image/png"));
    const iconRec = () => B(`new Promise(r => { const o = indexedDB.open("macc-history"); o.onsuccess = () => {
      const q = o.result.transaction("icons").objectStore("icons").get("${ORIGIN}"); q.onsuccess = () => r(q.result && {hash: q.result.hash, updated: q.result.updated}); }; })`);
    const rec1 = await iconRec();
    check("saved icon has a content hash", !!rec1 && /^[0-9a-f]{64}$/.test(rec1.hash), rec1);
    await B(`browser.tabs.reload(${spaTab})`);
    await settle(800);
    const rec2 = await iconRec();
    check("revisiting with the same icon doesn't rewrite it", rec2.hash === rec1.hash && rec2.updated === rec1.updated, [rec1, rec2]);
    execFileSync("curl", ["-s", `${ORIGIN}/seticon?c=red`]);
    await B(`browser.tabs.reload(${spaTab})`);
    await settle(800);
    const rec3 = await iconRec();
    check("a changed icon is picked up on the next visit", rec3.hash !== rec1.hash && rec3.updated > rec1.updated, [rec1, rec3]);
    execFileSync("curl", ["-s", `${ORIGIN}/seticon?c=blue`]);
    // The toolbar menu's history item: a new tab with the history drawer open at the container.
    await B(`browser.tabs.update(${spaTab}, {url: "chrome-extension://${extId}/newtab.html#history=2"})`);
    await settle();
    const hp = await pageSession("newtab.html#history");
    await sleep(800);
    const hrows = await P(hp, `[document.documentElement.classList.contains("history-open"), document.querySelector("#history-drawer .picker-button").textContent,
      [...document.querySelectorAll("#history-drawer .row")].map(r => r.querySelector(".text .title").textContent)]`);
    check("#history=2 opens the history drawer at the container", hrows[0] && hrows[1] === "Work" && hrows[2].length > 0, hrows);
    check("history drawer shows saved icons", await P(hp, `[...document.querySelectorAll("#history-drawer .row .favicon")].some(f => f.style.backgroundImage.includes("data:image"))`));
    await P(hp, `(() => { const q = document.querySelector(".history-q"); q.value = "zzz-no-such-page"; q.dispatchEvent(new Event("input")); })()`);
    await sleep(600);
    const searched = await P(hp, `[document.querySelectorAll("#history-drawer .row").length, document.querySelector("#history-drawer .empty").hidden, document.querySelector(".clear-history").textContent]`);
    check("history drawer search; clear button names the container", searched[0] === 0 && !searched[1] && searched[2] === "Clear Work", searched);
    await P(hp, `(() => { const q = document.querySelector(".history-q"); q.value = ""; q.dispatchEvent(new Event("input")); })()`);
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false }, hp);
    await sleep(500);
    const hshot = await c.send("Page.captureScreenshot", { format: "png" }, hp);
    fs.writeFileSync((process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png")).replace(/\.png$/, "-history.png"), Buffer.from(hshot.data, "base64"));
    await B(`__maccHistory.clear(2)`);
    check("clearing a container's history", (await hq({ n: 2 })).length === 0 && (await hq({ n: 0 })).length > 0);
    await B(`browser.tabs.remove(${spaTab})`);

    // Settings: the options page is the new tab page with the settings drawer open.
    await B(`browser.runtime.openOptionsPage()`);
    await settle();
    const opt = await pageSession("newtab.html#settings");
    await sleep(800);
    check("options page opens the new tab page's settings drawer", await P(opt, `document.documentElement.classList.contains("settings-open")`));
    const cards = await P(opt, `[...document.querySelectorAll(".card h2")].map(h => h.textContent)`);
    check("settings sections", JSON.stringify(cards) === JSON.stringify(["Search engine", "Colors", "Weather", "Wallpaper", "Container highlighting", "Tabs", "Keyboard shortcuts", "Introduction"]), cards);
    const optLeft = await P(opt, "document.body.innerText.match(/.{0,30}(sync|vpn|mozilla|firefox|proxy|helper).{0,30}/i)?.[0] ?? null");
    check("settings have no Sync, VPN, proxy or helper settings", optLeft === null, optLeft);
    await P(opt, `(() => { const s = document.getElementById("engine"); s.value = [...s.options].find(o => o.textContent === "DuckDuckGo").value; s.dispatchEvent(new Event("change")); })()`);
    await sleep(300);
    check("picking an engine in settings saves it", (await B(`__maccSearch.engine().then(e => e && e.name)`)) === "DuckDuckGo");
    await P(opt, `(() => { const s = document.getElementById("engine"); s.value = "custom"; s.dispatchEvent(new Event("change")); })()`);
    await P(opt, `(() => { const [n, u] = document.querySelectorAll(".custom-engine input"); n.value = "Bad"; u.value = "https://example.com/"; document.querySelector(".custom-engine .primary").click(); })()`);
    await sleep(300);
    check("custom engine without %s is refused", /needs %s/.test(await P(opt, `document.querySelector(".custom-engine .saved").textContent`))
      && (await B(`__maccSearch.engine().then(e => e && e.name)`)) === "DuckDuckGo");
    await B(`__maccSearch.setEngine(null)`);
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 1400, deviceScaleFactor: 1, mobile: false }, opt);
    await sleep(300);
    fs.writeFileSync((process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png")).replace(/\.png$/, "-settings.png"),
      Buffer.from((await c.send("Page.captureScreenshot", { format: "png" }, opt)).data, "base64"));

    // Onboarding ends after its fourth panel (the Firefox-only ones are gone).
    await B(`browser.storage.local.set({"onboarding-stage": 3})`);
    await B(`browser.tabs.create({url: "chrome-extension://${extId}/popup.html"})`);
    await settle();
    const popT = (await c.targets()).find((t) => t.url.endsWith("/popup.html"));
    const pop = await c.attach(popT.targetId);
    await sleep(500);
    await P(pop, `document.getElementById("onboarding-done-button").click()`);
    await sleep(500);
    check("onboarding finishes at the containers list", (await P(pop, `!document.getElementById("container-panel").classList.contains("hide")`))
      && (await B(`browser.storage.local.get("onboarding-stage").then(s => s["onboarding-stage"])`)) === 8);
    await P(pop, "location.reload()");
    await sleep(800);
    await c.send("Runtime.enable", {}, pop);
    await c.send("Emulation.setDeviceMetricsOverride", { width: 360, height: 600, deviceScaleFactor: 2, mobile: false }, pop);
    await sleep(500);
    const shot = await c.send("Page.captureScreenshot", { format: "png" }, pop);
    fs.writeFileSync(process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png"), Buffer.from(shot.data, "base64"));
    const rows = await P(pop, "[...document.querySelectorAll('#identities-list .menu-item-name, .identities-list .menu-item-name, [data-identity-cookie-store-id]')].map(e => e.textContent.trim()).filter(Boolean)");
    check("popup lists containers", rows.join(" ").includes("Work") && rows.join(" ").includes("Test"), rows);

    // Edit panel: no proxy or Mozilla VPN UI.
    await P(pop, `browser.contextualIdentities.get("firefox-container-2").then(i => Logic.showPanel("containerEdit", i))`);
    await sleep(800);
    const editShot = await c.send("Page.captureScreenshot", { format: "png" }, pop);
    fs.writeFileSync((process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png")).replace(/\.png$/, "-edit.png"), Buffer.from(editShot.data, "base64"));
    check("edit panel has no proxy settings", await P(pop, "!document.querySelector('[id*=proxy]')"));
    { const brand = await P(pop, "[(document.body.innerText + document.title).match(/.{0,40}(firefox|mozilla).{0,40}/i)?.[0] ?? null, document.querySelector('moz-vpn-container-ui, img[src*=mozilla]')?.outerHTML ?? null]");
      check("popup has no Firefox branding or Mozilla VPN UI", brand[0] === null && brand[1] === null, brand); }
    const sel = await P(pop, `["color", "icon"].map(k => { const i = document.querySelector('#edit-container-panel-choose-' + k + ' input:checked'); return i ? [i.value, getComputedStyle(i.nextElementSibling).backgroundColor] : null; })`);
    check("edit panel marks the current color and icon", sel[0] && sel[0][0] === "orange" && sel[1] && sel[1][0] === "briefcase"
      && sel.every((x) => x[1] !== "rgba(0, 0, 0, 0)"), sel);

    // Custom colors from the settings page reach every extension page.
    await P(opt, `[...document.querySelectorAll(".segmented button")].find(b => b.textContent === "Custom").click()`);
    await P(opt, `(() => { const s = document.querySelector(".card:nth-of-type(2) select"); s.value = "Catppuccin Mocha"; s.dispatchEvent(new Event("change")); })()`);
    await sleep(600);
    const palette = await B(`localStorage.getItem("maccPalette")`);
    check("custom colors saved as the page palette", palette && JSON.parse(palette).scheme === "dark", palette);
    const themedTab = await B(`browser.tabs.create({}).then(t => t.id)`);
    const themed = await pageSession("newtab");
    await sleep(500);
    const ntpLook = await P(themed, `[getComputedStyle(document.body).backgroundColor, getComputedStyle(document.body).color, getComputedStyle(document.documentElement).colorScheme]`);
    check("new tab page uses the custom colors", ntpLook[0] === "rgb(30, 30, 46)" && ntpLook[1] === "rgb(205, 214, 244)" && ntpLook[2] === "dark", ntpLook);
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 750, deviceScaleFactor: 1, mobile: false }, themed);
    await sleep(300);
    fs.writeFileSync((process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png")).replace(/\.png$/, "-theme-newtab.png"),
      Buffer.from((await c.send("Page.captureScreenshot", { format: "png" }, themed)).data, "base64"));
    await P(pop, "location.reload()");
    await sleep(1000);
    const popLook = await P(pop, `[getComputedStyle(document.body).backgroundColor, document.documentElement.dataset.theme]`);
    check("dark popup inverts the (baked black) always-open icon", (await P(pop, `getComputedStyle(document.querySelector("#always-open-in .menu-icon")).filter`)) === "invert(1)");
    check("popup uses the custom colors", popLook[0] === "rgb(30, 30, 46)" && popLook[1] === "dark", popLook);
    fs.writeFileSync((process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png")).replace(/\.png$/, "-theme-popup.png"),
      Buffer.from((await c.send("Page.captureScreenshot", { format: "png" }, pop)).data, "base64"));
    await P(opt, `[...document.querySelectorAll(".segmented button")].find(b => b.textContent === "Light").click()`);
    await sleep(600);
    const light = await P(themed, `[document.documentElement.dataset.browserTheme, getComputedStyle(document.body).backgroundColor]`);
    check("Light colors in settings", light[0] === "light" && light[1] === "rgb(249, 249, 251)", light);
    await P(opt, `[...document.querySelectorAll(".segmented button")].find(b => b.textContent === "System").click()`);
    await sleep(600);
    check("System colors: no palette", (await B(`localStorage.getItem("maccPalette")`)) === null
      && (await P(themed, `document.documentElement.dataset.browserTheme ?? null`)) === null
      && (await B(`browser.storage.local.get("currentTheme").then(s => s.currentTheme)`)) === "auto");
    await B(`browser.tabs.remove(${themedTab})`);

    // Weather (Open-Meteo, answered here) and wallpaper.
    const meteo = [];
    c.on((m) => {
      if (m.method !== "Fetch.requestPaused") return;
      const u = new URL(m.params.request.url);
      meteo.push(u.href);
      const body = u.hostname.startsWith("geocoding")
        ? { results: [{ name: "Testville", latitude: 10.5, longitude: 20.25, admin1: "Test State", country: "Testland" }] }
        : (() => {
          // Times around the real clock (the page shows the hours after the current one), at UTC+0.
          const hour = (i) => new Date(Date.now() + i * 3600e3).toISOString().slice(0, 13) + ":00";
          const day = (i) => new Date(Date.now() + i * 86400e3).toISOString().slice(0, 10);
          const hours = [0, 1, 2, 3, 4, 5, 6, 7];
          return {
            utc_offset_seconds: 0,
            current: { temperature_2m: u.searchParams.get("latitude") === "10.5" ? 12.3 : 30, apparent_temperature: 9.6, weather_code: 63, is_day: 0, wind_speed_10m: 12, time: hour(0) },
            hourly: { time: hours.map(hour), temperature_2m: hours.map((i) => 10 + i), weather_code: hours.map((i) => (i < 3 ? 63 : 3)), is_day: hours.map(() => 0) },
            daily: { time: [0, 1, 2].map(day), temperature_2m_max: [14, 16, 9], temperature_2m_min: [5, 7, -2], weather_code: [63, 0, 73] },
          };
        })();
      c.send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }],
        body: Buffer.from(JSON.stringify(body)).toString("base64") }, m.sessionId).catch(() => {});
    });
    await c.send("Fetch.enable", { patterns: [{ urlPattern: "*open-meteo.com*" }] }, bg);
    await c.send("Browser.grantPermissions", { permissions: ["geolocation"], origin: `chrome-extension://${extId}` });
    await c.send("Emulation.setGeolocationOverride", { latitude: 40.75, longitude: -73.5, accuracy: 10 }, opt);
    // Hidden pages get no positions.
    await P(opt, `new Promise(r => chrome.tabs.getCurrent(t => chrome.tabs.update(t.id, { active: true }, r))).then(() => 0)`);
    await P(opt, `[...document.querySelectorAll("#weather-settings button")].find(b => b.textContent === "Use my location").click()`);
    let geo = null;
    for (let i = 0; i < 50 && !geo; i++) { await sleep(100); geo = await B(`__maccWeather.settings().then(s => s.place)`); }
    check("Use my location saves the browser's position", geo && geo.name === "My location" && geo.latitude === 40.75 && geo.longitude === -73.5,
      [geo, await P(opt, `[document.querySelector("#weather-settings .saved").textContent, [...document.querySelectorAll("#weather-settings button")].map(b => b.textContent).join("|")]`)]);
    await P(opt, `(() => { const q = document.querySelector("#weather-settings .place-search input"); q.value = "12345"; q.nextElementSibling.click(); })()`);
    await sleep(600);
    const found = await P(opt, `[...document.querySelectorAll("#weather-settings .places button")].map(b => b.textContent)`);
    check("place search by postal code lists Open-Meteo's matches", found.length === 1 && found[0] === "TestvilleTest State, Testland", found);
    check("geocoding asks Open-Meteo for the postal code", meteo.some((u) => u.startsWith("https://geocoding-api.open-meteo.com/v1/search?name=12345")), meteo);
    await P(opt, `document.querySelector("#weather-settings .places button").click()`);
    await sleep(400);
    const placed = await B(`__maccWeather.settings().then(s => [s.place.name, s.place.latitude, s.place.longitude])`);
    check("picking a match saves it as the weather's place", JSON.stringify(placed) === JSON.stringify(["Testville", 10.5, 20.25]), placed);
    const wTab = await B(`browser.tabs.create({}).then(t => t.id)`);
    const wNtp = await pageSession("newtab");
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 750, deviceScaleFactor: 1, mobile: false }, wNtp);
    await sleep(1200);
    const wLine = await P(wNtp, `(() => { const w = document.getElementById("weather"), q = document.getElementById("q").getBoundingClientRect(), b = w.getBoundingClientRect();
      return [document.getElementById("weather-box").hidden, w.textContent, Math.round(q.top - b.bottom), Math.round(b.left - q.left), document.documentElement.dataset.effect]; })()`);
    check("weather sits over the search box", !wLine[0] && wLine[1].startsWith("12°Rain") && wLine[1].includes("Testville") && wLine[2] >= 0 && wLine[2] < 30 && wLine[3] === 0, wLine);
    const fcHidden = await P(wNtp, `getComputedStyle(document.getElementById("forecast")).visibility`);
    const wBox = await P(wNtp, `(() => { const b = document.getElementById("weather").getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`);
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: wBox[0], y: wBox[1] }, wNtp);
    await sleep(400);
    const fc = await P(wNtp, `(() => { const f = document.getElementById("forecast"), rows = [...f.querySelectorAll(".f-row")];
      return [getComputedStyle(f).visibility, rows.map(r => [r.querySelector(".f-title").textContent, r.querySelectorAll(".f-cell").length]),
        [...f.querySelectorAll(".days .f-cell")].map(c => c.textContent), [...f.querySelectorAll(".hours .w-temp")].map(c => c.textContent)]; })()`);
    check("hovering the weather shows a 5 hour and 3 day forecast", fcHidden === "hidden" && fc[0] === "visible"
      && JSON.stringify(fc[1]) === JSON.stringify([["Next hours", 5], ["Next days", 3]]) && fc[2][0] === "Today14°5°Rain" && fc[3].join() === "11°,12°,13°,14°,15°", fc);
    fs.writeFileSync((process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png")).replace(/\.png$/, "-forecast.png"),
      Buffer.from((await c.send("Page.captureScreenshot", { format: "png" }, wNtp)).data, "base64"));
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 700 }, wNtp);
    const fetches = meteo.filter((u) => u.includes("forecast")).length;
    const cTab2 = await B(`browser.tabs.create({}).then(t => t.id)`);
    await sleep(1200);
    check("another new tab reuses the hour-old reading", meteo.filter((u) => u.includes("forecast")).length === fetches);
    await B(`browser.tabs.remove(${cTab2})`);
    const sect = await P(wNtp, `(() => { const s = getComputedStyle(document.querySelector(".container-section")); return [s.borderTopWidth, s.backgroundColor, s.backdropFilter, s.paddingLeft]; })()`);
    check("frequent sites grouped on the container color with a thick, blurred border", sect[0] === "6px" && sect[1] !== "rgba(0, 0, 0, 0)" && sect[2].startsWith("blur") && sect[3] === "18px", sect);
    check("forecast asked for the place's current weather", meteo.some((u) => /api\.open-meteo\.com\/v1\/forecast\?latitude=10\.5&longitude=20\.25&current=/.test(u)), meteo.filter((u) => u.includes("forecast")));
    check("rain plays the rain effect", wLine[4] === "rain", wLine[4]);
    const sceneLook = async (s) => P(s, `(() => { const c = document.getElementById("scene"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let h = 0, opaque = 0; for (let i = 0; i < d.length; i += 4) { h = (h * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) >>> 0; if (d[i + 3] === 255) opaque++; }
      return { hidden: c.hidden, w: c.width, h: c.height, pixelated: getComputedStyle(c).imageRendering, cover: getComputedStyle(c).objectFit, hash: h, opaque: opaque / (c.width * c.height) }; })()`);
    const s1 = await sceneLook(wNtp);
    await sleep(400);
    const s2 = await sceneLook(wNtp);
    check("pixel scene: 320x180 canvas scaled up with crisp pixels", !s1.hidden && s1.w === 320 && s1.h === 180 && s1.pixelated === "pixelated" && s1.cover === "cover", s1);
    check("pixel sky fills the scene and the rain moves", s1.opaque === 1 && s1.hash !== s2.hash, [s1.hash, s2.hash]);
    check("text over the wallpaper gets a backing", (await P(wNtp, `getComputedStyle(document.querySelector("#history-toggle")).backgroundColor`)) !== "rgba(0, 0, 0, 0)");
    fs.writeFileSync((process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png")).replace(/\.png$/, "-weather-rain.png"),
      Buffer.from((await c.send("Page.captureScreenshot", { format: "png" }, wNtp)).data, "base64"));
    await P(opt, `(() => { const s = [...document.querySelectorAll("#weather-settings select")][0]; s.value = "snow"; s.dispatchEvent(new Event("change")); })()`);
    await sleep(800);
    check("picking an effect in settings changes open new tabs", (await P(wNtp, `document.documentElement.dataset.effect`)) === "snow");
    fs.writeFileSync((process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png")).replace(/\.png$/, "-weather-snow.png"),
      Buffer.from((await c.send("Page.captureScreenshot", { format: "png" }, wNtp)).data, "base64"));
    await P(opt, `[...document.querySelectorAll("#weather-settings .segmented button")].find(b => b.textContent === "°F").click()`);
    await sleep(800);
    check("units: °F asks Open-Meteo in fahrenheit", meteo.some((u) => u.includes("forecast") && u.includes("temperature_unit=fahrenheit")) && (await P(wNtp, `document.querySelector(".w-temp").textContent`)) === "12°");
    // An image wallpaper: the scene turns transparent over it.
    await P(opt, `(() => { const u = [...document.querySelectorAll(".card")].find(c => c.querySelector("h2").textContent === "Wallpaper").querySelector(".place-search input"); u.value = "${ORIGIN}/page?wallpaper=1"; u.nextElementSibling.click(); })()`);
    await sleep(800);
    const img = await P(wNtp, `(() => { const w = document.getElementById("wallpaper"); return [w.hidden, getComputedStyle(w).backgroundImage, getComputedStyle(w).backgroundSize]; })()`);
    const s3 = await sceneLook(wNtp);
    check("image wallpaper covers the page", !img[0] && img[1].includes("wallpaper=1") && img[2] === "cover", img);
    check("weather plays over the image (transparent scene)", !s3.hidden && s3.opaque < 0.5, s3.opaque);
    await B(`__maccWallpaper.set({ dim: 0.4, blur: 12 })`);
    await sleep(400);
    const veil = await P(wNtp, `(() => { const s = getComputedStyle(document.getElementById("wallpaper-dim")); return [s.backgroundColor, s.backdropFilter]; })()`);
    check("dim darkens and blur softens the wallpaper", veil[0] === "rgba(0, 0, 0, 0.4)" && veil[1] === "blur(12px)", veil);
    fs.writeFileSync((process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png")).replace(/\.png$/, "-wallpaper-blur.png"),
      Buffer.from((await c.send("Page.captureScreenshot", { format: "png" }, wNtp)).data, "base64"));
    const drawerCards = await P(wNtp, `(() => { document.getElementById("settings-toggle").click();
      return new Promise(r => setTimeout(() => r(["Weather", "Wallpaper"].map(t => { const h = [...document.querySelectorAll("#settings-drawer .card h2")].find(h => h.textContent === t);
        return h ? [getComputedStyle(h.closest(".card")).opacity, h.closest(".card").getBoundingClientRect().height > 100] : null; })), 700)); })()`);
    check("Weather and Wallpaper cards show in the settings drawer", JSON.stringify(drawerCards) === JSON.stringify([["1", true], ["1", true]]), drawerCards);
    await P(wNtp, `document.querySelector("#settings-drawer .close").click()`);
    await B(`__maccWallpaper.set({ kind: "none" }).then(() => __maccWeather.set({ effects: "off", show: false }))`);
    await sleep(500);
    const plain = await P(wNtp, `[document.getElementById("scene").hidden, document.getElementById("wallpaper").hidden, document.getElementById("weather-box").hidden, document.documentElement.classList.contains("has-wallpaper")]`);
    check("no wallpaper, effects off, weather hidden: the plain page", plain[0] && plain[1] && plain[2] && !plain[3], plain);
    await B(`browser.tabs.remove(${wTab})`);
    await c.send("Fetch.disable", {}, bg);
  } catch (e) {
    failed++;
    console.error("ERROR", e.message);
  } finally {
    const relevant = errors.filter((e) => !/mozillavpn/i.test(e));
    if (relevant.length) console.log("background errors:\n  " + relevant.join("\n  "));
    c.close();
  }
}

children.forEach((p) => p.kill());
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
