// End-to-end test of the Chromium port against headless Helium/Chromium.
//
//   node chrome/test/e2e.mjs        (BROWSER=chromium to use another browser)
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
    const t = (await c.targets()).find((x) => x.type === "page" && x.url.includes(urlPart));
    if (!t) throw new Error(`no page ${urlPart}: ${(await c.targets()).map((x) => x.url).join(", ")}`);
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

    // Popup renders (skip the first-run onboarding panels).
    await B(`browser.storage.local.set({"onboarding-stage": 8})`);
    await B(`browser.tabs.create({url: "chrome-extension://${extId}/popup.html"})`);
    await settle();
    const popT = (await c.targets()).find((t) => t.url.endsWith("/popup.html"));
    const pop = await c.attach(popT.targetId);
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
    check("Mozilla VPN controls hidden", await P(pop, "getComputedStyle(document.querySelector('moz-vpn-container-ui')).display === 'none'"));
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
