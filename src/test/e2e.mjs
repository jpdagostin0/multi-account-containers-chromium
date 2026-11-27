// End-to-end test of the Chromium port against headless Helium/Chromium.
//
//   node src/test/e2e.mjs        (BROWSER=chromium to use another browser)
//
// Starts its own test servers, two upstream proxies and the proxy helper.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, extDir, sleep } from "./cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT_ID = "onhincpcieoahedkojoldccglpaokjln";
const COMPANION_ID = "jeedhomnaldfldmfkfekpifefpfcpbll";
const LAN = execFileSync("ip", ["-4", "route", "get", "1.1.1.1"]).toString().match(/src (\S+)/)[1];
const ORIGIN = "http://127.0.0.1:8765";
const ALT = "http://localhost:8765";
const PLAIN = `http://${LAN}:8767`;
const TLS = `https://${LAN}:8766`;
const UP_A = 8781;
const UP_B = 8782;

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
py(path.join(here, "server.py"), "8767", LAN, "8766");
py(path.join(here, "upstream.py"), String(UP_A), "A");
py(path.join(here, "upstream.py"), String(UP_B), "B");

const helperBin = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "macc-helper-")), "macc-proxy-helper");
const go = fs.existsSync(path.join(os.homedir(), ".local/go/bin/go")) ? path.join(os.homedir(), ".local/go/bin/go") : "go";
execFileSync(go, ["build", "-o", helperBin, "."], { cwd: path.join(here, "..", "helper"), stdio: "inherit" });
const installHelper = (profile) => {
  const dir = path.join(profile, "NativeMessagingHosts");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "io.github.jpdagostin0.macc_proxy.json"), JSON.stringify({
    name: "io.github.jpdagostin0.macc_proxy",
    description: "test",
    path: helperBin,
    type: "stdio",
    allowed_origins: [`chrome-extension://${EXT_ID}/`],
  }));
};
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
      t = (await c.targets()).find((x) => x.type === "page" && x.url.includes(urlPart));
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
  const c = await launch({ args: ["--ignore-certificate-errors"], prepare: installHelper });
  let errors = [];
  try {
    const { id: extId, B, settle, pageSession, P, echo, errors: errs } = await session(c);
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

    // Highlighting: favicon dot (default), then page border + tab groups.
    await sleep(500);
    const iconPixels = (s) => P(s, `(async () => {
      const l = document.querySelector('link[rel~="icon"]');
      if (!l || !l.href.startsWith("data:")) return null;
      const img = new Image(); img.src = l.href; await img.decode();
      const c = document.createElement("canvas"); c.width = c.height = 32;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0);
      const px = (a, b) => Array.from(x.getImageData(a, b, 1, 1).data.slice(0, 3)).join(",");
      return { icon: px(19, 16), dot: px(1, 16) };
    })()`);
    const near = (px, rgb) => !!px && px.split(",").every((v, i) => Math.abs(Number(v) - rgb[i]) <= 3);
    const wp = await iconPixels(work);
    check("container tab favicon keeps the site icon and gets an orange line", wp && near(wp.icon, [0, 0, 255]) && near(wp.dot, [255, 159, 0]), wp);
    let tabIcon = "";
    for (let i = 0; i < 30 && !tabIcon.startsWith("data:"); i++) {
      tabIcon = (await B(`browser.tabs.get(${workTab}).then(t => t.favIconUrl || "")`));
      if (!tabIcon.startsWith("data:")) await sleep(100);
    }
    check("browser uses the marked icon for the tab", tabIcon.startsWith("data:image/png"), tabIcon.slice(0, 40));
    check("default tab favicon untouched", (await iconPixels(def)) === null);
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
    check("…and its icon line", near(((await iconPixels(work)) || {}).dot, [175, 81, 245]), await iconPixels(work));
    await B(`browser.contextualIdentities.update("firefox-container-2", {name: "Work", color: "orange"})`);
    await B("__maccHighlight.setSettings({pageBorder: false, faviconMarker: false, tabGroups: false})");
    await sleep(800);
    check("page border can be turned off", (await frameColor(work)) === null);
    check("icon line can be turned off", (await iconPixels(work)) === null);
    check("turning tab groups off ungroups", (await B(`browser.tabs.get(${workTab}).then(t => t.groupId)`)) === -1);
    await B("__maccHighlight.setSettings({faviconMarker: true})");

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
    check("new tab page lists top sites per container", ntpSections[0][0] === "No container" && work2 && work2[1].includes(`${ORIGIN}/set`) && work2[1].includes(`${ORIGIN}/csp`), ntpSections);
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
    await B(`browser.tabs.update(${spaTab}, {url: "chrome-extension://${extId}/history.html?container=2"})`);
    await settle();
    const hp = await pageSession("history.html");
    await sleep(600);
    const hrows = await P(hp, `[...document.querySelectorAll(".row")].map(r => r.querySelector(".badge").textContent)`);
    check("history page filtered to the container", hrows.length > 0 && hrows.every((b) => b === "Work"), hrows);
    check("history page shows saved icons", await P(hp, `[...document.querySelectorAll(".row .favicon")].some(f => f.style.backgroundImage.includes("data:image"))`));
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false }, hp);
    await sleep(300);
    const hshot = await c.send("Page.captureScreenshot", { format: "png" }, hp);
    fs.writeFileSync((process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png")).replace(/\.png$/, "-history.png"), Buffer.from(hshot.data, "base64"));
    await B(`__maccHistory.clear(2)`);
    check("clearing a container's history", (await hq({ n: 2 })).length === 0 && (await hq({ n: 0 })).length > 0);
    await B(`browser.tabs.remove(${spaTab})`);

    // -------------------------------------------------------------------------
    // per-container proxies
    // -------------------------------------------------------------------------
    await B(`browser.storage.local.set({proxifiedContainersKey: [
      {cookieStoreId: "firefox-container-2", proxy: {type: "http", host: "127.0.0.1", port: "${UP_A}"}},
      {cookieStoreId: "firefox-container-4", proxy: {type: "http", host: "127.0.0.1", port: "${UP_B}"}}
    ]})`);
    let st;
    for (let i = 0; i < 50; i++) {
      st = await B("__maccProxy.status()");
      if (st.applied) break;
      await sleep(100);
    }
    check("proxy helper started and PAC applied", st.helperRunning && st.applied, st);

    const stats = async (port) => JSON.parse(execFileSync("curl", ["-s", `http://127.0.0.1:${port}/stats`]).toString());
    await B(`browser.tabs.create({cookieStoreId: "firefox-container-2", url: "${PLAIN}/page?proxied=a"})`);
    await settle();
    const pa = await pageSession("proxied=a");
    const viaA = await P(pa, "fetch('/echo').then(r => r.json())");
    check("container 2 plain HTTP goes through upstream A", viaA.upstream === "A", viaA);

    await B(`browser.tabs.create({cookieStoreId: "firefox-container-4", url: "${TLS}/page?proxied=b"})`);
    await settle();
    const pb = await pageSession("proxied=b");
    await P(pb, "fetch('/echo').then(r => r.json())");
    const [sa, sb] = [await stats(UP_A), await stats(UP_B)];
    check("container 4 HTTPS tunnels through upstream B only",
      (sb.connect[`${LAN}:8766`] || 0) > 0 && !sa.connect[`${LAN}:8766`], { A: sa, B: sb });
    check("container 4 never touched upstream A for its site", !sa.forward[`${LAN}:8766`]);

    const plainDefault = await B(`browser.tabs.create({url: "${PLAIN}/page?default=1"}).then(t => t.id)`);
    await settle();
    const conflictUrl = await B(`browser.tabs.get(${plainDefault}).then(t => t.url)`);
    check("same site in a differently-proxied container is refused", conflictUrl.includes("proxy-status.html?reason=conflict"), conflictUrl);

    await B(`browser.tabs.create({cookieStoreId: "firefox-container-1", url: "chrome-extension://${extId}/options.html"})`);
    await settle();
    const opt = await pageSession("/options.html");
    await sleep(500);
    const optText = await P(opt, "document.getElementById('macc-proxy-status').innerText");
    check("options page shows proxy status", /routing 2 container/.test(optText), optText);
    const optLeft = await P(opt, "document.body.innerText.match(/.{0,30}(sync|vpn|mozilla|firefox).{0,30}/i)?.[0] ?? null");
    check("options page has no Sync or Mozilla VPN settings", optLeft === null, optLeft);

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

    // Edit panel of a proxied container: Firefox's proxy UI, no Mozilla VPN.
    await P(pop, `browser.contextualIdentities.get("firefox-container-2").then(i => Logic.showPanel("containerEdit", i))`);
    await sleep(800);
    const editShot = await c.send("Page.captureScreenshot", { format: "png" }, pop);
    fs.writeFileSync((process.env.SHOT || path.join(os.tmpdir(), "macc-popup.png")).replace(/\.png$/, "-edit.png"), Buffer.from(editShot.data, "base64"));
    const proxyLabel = await P(pop, "document.getElementById('advanced-proxy-address').textContent");
    check("edit panel shows the container's proxy", proxyLabel === `http://127.0.0.1:${UP_A}`, proxyLabel);
    { const brand = await P(pop, "[(document.body.innerText + document.title).match(/.{0,40}(firefox|mozilla).{0,40}/i)?.[0] ?? null, document.querySelector('moz-vpn-container-ui, img[src*=mozilla]')?.outerHTML ?? null]");
      check("popup has no Firefox branding or Mozilla VPN UI", brand[0] === null && brand[1] === null, brand); }
    const sel = await P(pop, `["color", "icon"].map(k => { const i = document.querySelector('#edit-container-panel-choose-' + k + ' input:checked'); return i ? [i.value, getComputedStyle(i.nextElementSibling).backgroundColor] : null; })`);
    check("edit panel marks the current color and icon", sel[0] && sel[0][0] === "orange" && sel[1] && sel[1][0] === "briefcase"
      && sel.every((x) => x[1] !== "rgba(0, 0, 0, 0)"), sel);
  } catch (e) {
    failed++;
    console.error("ERROR", e.message);
  } finally {
    const relevant = errors.filter((e) => !/mozillavpn|native messaging host not found/i.test(e));
    if (relevant.length) console.log("background errors:\n  " + relevant.join("\n  "));
    c.close();
  }
}

// ---------------------------------------------------------------------------
// fail closed without the helper
// ---------------------------------------------------------------------------
{
  const c = await launch();
  try {
    const { B, settle } = await session(c, { withErrors: false });
    await B(`browser.storage.local.set({proxifiedContainersKey: [
      {cookieStoreId: "firefox-container-2", proxy: {type: "socks", host: "127.0.0.1", port: "1"}}]})`);
    await sleep(500);
    const t = await B(`browser.tabs.create({cookieStoreId: "firefox-container-2", url: "${ORIGIN}/page?noproxy=1"}).then(t => t.id)`);
    await settle();
    const url = await B(`browser.tabs.get(${t}).then(t => t.url)`);
    check("proxied container is blocked when the helper is missing", url.includes("proxy-status.html?reason=unavailable"), url);
    const d = await B(`browser.tabs.create({url: "${ORIGIN}/page?unproxied=1"}).then(t => t.id)`);
    await settle();
    check("unproxied tabs keep working", (await B(`browser.tabs.get(${d}).then(t => t.url)`)).includes("unproxied=1"));
  } catch (e) {
    failed++;
    console.error("ERROR", e.message);
  } finally {
    c.close();
  }
}

children.forEach((p) => p.kill());
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
