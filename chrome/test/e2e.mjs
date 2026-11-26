// End-to-end isolation test against headless Helium/Chromium.
//   python3 chrome/test/server.py 8765 &   then   node chrome/test/e2e.mjs
import fs from "node:fs";
import { launch, extDir, sleep } from "./cdp.mjs";

const ORIGIN = "http://127.0.0.1:8765";
const ALT = "http://localhost:8765";
const c = await launch();
const errors = [];
let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ""}`);
};

try {
  const { id: extId } = await c.send("Extensions.loadUnpacked", { path: extDir });
  await sleep(1500);
  const bgT = (await c.targets()).find((t) => t.url === `chrome-extension://${extId}/js/background/index.html`);
  const bg = await c.attach(bgT.targetId);
  c.on((m) => {
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  await c.send("Runtime.enable", {}, bg);
  const B = (expr) => c.evaluate(bg, expr);
  // Wait until every tab has finished loading.
  const settle = async (min = 300) => {
    await sleep(min);
    for (let i = 0; i < 100; i++) {
      const busy = await B("browser.tabs.query({}).then(l => l.some(t => t.status !== 'complete'))");
      if (!busy) return;
      await sleep(100);
    }
  };

  const idents = await B("browser.contextualIdentities.query({}).then(l => l.map(i => i.cookieStoreId + ':' + i.name))");
  check("default containers seeded", idents.length === 4, idents);

  const workTab = await B(`browser.tabs.create({cookieStoreId: "firefox-container-2", url: "${ORIGIN}/set?n=sid&v=work"}).then(t => t.id)`);
  const defTab = await B(`browser.tabs.create({url: "${ORIGIN}/set?n=sid&v=default"}).then(t => t.id)`);
  await settle();
  check("tabs.get reports cookieStoreId", (await B(`browser.tabs.get(${workTab}).then(t => t.cookieStoreId)`)) === "firefox-container-2");
  check("tabs.query filters by cookieStoreId",
    JSON.stringify(await B(`browser.tabs.query({cookieStoreId: "firefox-container-2"}).then(l => l.map(t => t.id))`)) === JSON.stringify([workTab]));

  const pageSession = async (urlPart) => {
    const t = (await c.targets()).find((x) => x.type === "page" && x.url.includes(urlPart));
    if (!t) throw new Error(`no page ${urlPart}: ${(await c.targets()).map((x) => x.type + " " + x.url).join(", ")}`);
    const s = await c.attach(t.targetId);
    await c.send("Runtime.enable", {}, s);
    return s;
  };
  const work = await pageSession("v=work");
  const def = await pageSession("v=default");
  const P = (s, e) => c.evaluate(s, e);
  const echo = (s) => P(s, "fetch('/echo').then(r => r.json()).then(j => j.cookie)");

  check("container request cookies", (await echo(work)) === "sid=work; http_sid=work", await echo(work));
  check("default request cookies", (await echo(def)) === "sid=default; http_sid=default", await echo(def));
  check("container document.cookie", (await P(work, "document.cookie")) === "sid=work", await P(work, "document.cookie"));
  check("default document.cookie", (await P(def, "document.cookie")) === "sid=default", await P(def, "document.cookie"));
  check("Server-Timing marker", (await P(work, "performance.getEntriesByType('navigation')[0].serverTiming.find(e => e.name === 'macc').description")) === "2|b");

  await P(work, "document.cookie = 'js=fromwork; path=/'");
  check("container JS-set cookie reaches server", (await echo(work)).includes("js=fromwork"), await echo(work));
  check("container JS-set cookie hidden from default", !(await echo(def)).includes("js=") && !(await P(def, "document.cookie")).includes("js="));

  const jar = await B("browser.cookies.getAll({}).then(l => l.map(c => c.name).sort())");
  check("jar stores prefixed names", jar.includes("MACC2~sid") && jar.includes("MACC2~http_sid") && jar.includes("sid"), jar);

  await P(work, "localStorage.setItem('k', 'work'); localStorage.other = 'x'");
  await P(def, "localStorage.setItem('k', 'default')");
  check("localStorage isolated (container)", (await P(work, "JSON.stringify([localStorage.getItem('k'), localStorage.length, Object.keys(localStorage).sort()])")) === JSON.stringify(["work", 2, ["k", "other"]]),
    await P(work, "JSON.stringify([localStorage.getItem('k'), localStorage.length, Object.keys(localStorage).sort()])"));
  check("localStorage isolated (default)", (await P(def, "JSON.stringify([localStorage.k, localStorage.length])")) === JSON.stringify(["default", 1]),
    await P(def, "JSON.stringify([localStorage.k, localStorage.length])"));

  await P(work, "new Promise(r => { const q = indexedDB.open('db1'); q.onsuccess = () => { q.result.close(); r(); }; })");
  const dbs = await P(def, "indexedDB.databases().then(l => l.map(d => d.name))");
  check("IndexedDB hidden from default", !dbs.length, dbs);
  check("IndexedDB visible in container", JSON.stringify(await P(work, "indexedDB.databases().then(l => l.map(d => d.name))")) === '["db1"]');

  const cs = await P(work, "cookieStore.getAll().then(l => l.map(c => c.name).sort())");
  check("cookieStore filtered", JSON.stringify(cs) === JSON.stringify(["js", "sid"]), cs);

  check("SW registration blocked in container", (await P(work, "navigator.serviceWorker.register('/sw.js').then(() => 'ok', e => e.name)")) === "SecurityError");

  // Inheritance: window.open from a container tab.
  await P(work, `void window.open('${ORIGIN}/page?child=1', '_blank')`);
  await settle();
  const child = await B(`browser.tabs.query({}).then(l => l.filter(t => t.url.includes('child=1')).map(t => t.cookieStoreId))`);
  check("window.open inherits container", child[0] === "firefox-container-2", child);
  const childS = await pageSession("child=1");
  check("child tab cookies", (await echo(childS)).startsWith("sid=work"), await echo(childS));

  // CSP page in a container tab: shim must still apply.
  await B(`browser.tabs.update(${workTab}, {url: "${ORIGIN}/csp"})`);
  await settle();
  const cspS = await pageSession("/csp");
  check("shim runs under strict CSP", (await P(cspS, "document.cookie")) === "js=fromwork; sid=work" || (await P(cspS, "document.cookie")) === "sid=work; js=fromwork", await P(cspS, "document.cookie"));

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

  // Container lifecycle through the upstream message API.
  const created = await B(`browser.contextualIdentities.create({name: "Test", color: "red", icon: "gift"})`);
  check("create container", created.cookieStoreId === "firefox-container-5", created);
  await B(`browser.contextualIdentities.remove("firefox-container-3")`);
  await settle();
  check("removing a container closes its tabs",
    (await B(`browser.tabs.query({}).then(l => l.some(t => t.id === ${defTab}))`)) === false);
  const jar2 = await B("browser.cookies.getAll({}).then(l => l.map(c => c.name))");
  check("removing a container purges its cookies", !jar2.some((n) => n.startsWith("MACC3~")), jar2);

  // Popup renders.
  const popupTab = await B(`browser.tabs.create({url: "chrome-extension://${extId}/popup.html"}).then(t => t.id)`);
  await settle();
  const popT = (await c.targets()).find((t) => t.url.endsWith("/popup.html"));
  const pop = await c.attach(popT.targetId);
  await c.send("Runtime.enable", {}, pop);
  await c.send("Emulation.setDeviceMetricsOverride", { width: 360, height: 600, deviceScaleFactor: 2, mobile: false }, pop);
  await sleep(500);
  const shot = await c.send("Page.captureScreenshot", { format: "png" }, pop);
  fs.writeFileSync(process.env.SHOT || "popup.png", Buffer.from(shot.data, "base64"));
  void popupTab;
} catch (e) {
  failed++;
  console.error("ERROR", e.message);
} finally {
  if (errors.length) console.log("background errors:\n  " + errors.join("\n  "));
  console.log(failed ? `${failed} failed` : "all passed");
  c.close();
  process.exit(failed ? 1 : 0);
}
