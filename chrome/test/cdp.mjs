// Minimal CDP-over-pipe harness: launches headless Helium/Chromium, loads the
// built extension with Extensions.loadUnpacked, and exposes helpers.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const extDir = path.resolve(here, "../../dist/chromium");

export async function launch({ browser = process.env.BROWSER || "helium", headless = true } = {}) {
  const profile = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "macc-prof-"));
  const args = [
    `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-pipe", "--enable-unsafe-extension-debugging",
    "--window-size=1280,900",
  ];
  if (headless) args.push("--headless=new");
  args.push("about:blank");
  const proc = spawn(browser, args, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  proc.stderr.on("data", () => {});
  const out = proc.stdio[3];
  const inp = proc.stdio[4];
  let id = 0;
  const pending = new Map();
  const listeners = [];
  let buf = Buffer.alloc(0);
  inp.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    let i;
    while ((i = buf.indexOf(0)) >= 0) {
      const msg = JSON.parse(buf.subarray(0, i).toString());
      buf = buf.subarray(i + 1);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else {
        listeners.forEach((l) => l(msg));
      }
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    const m = { id: mid, method, params };
    if (sessionId) m.sessionId = sessionId;
    out.write(JSON.stringify(m) + "\0");
  });
  const cdp = {
    proc, send, profile,
    on: (fn) => listeners.push(fn),
    async attach(targetId) {
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      return sessionId;
    },
    async evaluate(sessionId, expression) {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
      if (r.exceptionDetails) throw new Error(`${expression}\n=> ${JSON.stringify(r.exceptionDetails)}`);
      return r.result.value;
    },
    async targets() {
      return (await send("Target.getTargets")).targetInfos;
    },
    close() {
      proc.kill();
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
  return cdp;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
