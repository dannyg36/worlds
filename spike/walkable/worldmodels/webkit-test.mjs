#!/usr/bin/env node
// Drives walk.html in Playwright WebKit with iPhone emulation, while cloud phones are unavailable.
// This is WebKit's engine and media stack on this machine (software rendering, GStreamer decode), not an iPhone:
// report its timings as "WebKit emulation", never as phone performance.
//
//   cd spike/walkable/worldmodels && npm i --no-save playwright@1 && npx playwright install --with-deps webkit
//   node webkit-test.mjs [--base http://localhost:5104] [--device "iPhone 15 Pro"]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webkit, devices } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes("--" + k) ? argv[argv.indexOf("--" + k) + 1] : d);
const BASE = arg("base", "http://localhost:5104");
const DEVICE = arg("device", "iPhone 15 Pro");
const outDir = path.join(here, "captures", "webkit");
fs.mkdirSync(outDir, { recursive: true });

const PLANS = [
  { day: "hackathon", set: "hailuo", steps: [{ tap: "up", mid: 2500 }, { swipe: "up" }, { swipe: "down" }, { swipe: "left" }, { swipe: "down" }, { swipe: "down" }, { swipe: "right" }, { tap: "down" }] },
  { day: "hackathon", set: "wan", steps: [{ swipe: "right" }, { swipe: "up", mid: 2000 }, { swipe: "down" }, { swipe: "down" }] },
  { day: "santa-cruz", set: "hailuo", steps: [{ swipe: "up", mid: 3000 }, { swipe: "down" }, { swipe: "left" }] },
  { day: "santa-cruz", set: "wan", steps: [{ swipe: "right", mid: 2000 }] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await sleep(100);
  }
  return false;
}

async function swipe(page, dir) {
  const vp = page.viewportSize();
  const cx = Math.round(vp.width / 2);
  const cy = Math.round(vp.height * 0.45);
  const [dx, dy] = { up: [0, -140], down: [0, 140], left: [-140, 0], right: [140, 0] }[dir];
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 6 });
  await page.mouse.up();
}

const browser = await webkit.launch();
const context = await browser.newContext({ ...devices[DEVICE] });
const results = [];
for (const plan of PLANS) {
  const page = await context.newPage();
  const errors = [];
  const stats = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/stats")) {
      try {
        stats.push(JSON.parse(r.postData()));
      } catch {}
    }
  });
  const name = plan.day + "-" + plan.set;
  const t0 = Date.now();
  await page.goto(BASE + "/walk.html?day=" + plan.day + "&set=" + plan.set + "&tag=webkit-emulation", { waitUntil: "load" });
  await page.waitForSelector("body.ready", { timeout: 120000 });
  const readyMs = Date.now() - t0;
  await page.screenshot({ path: path.join(outDir, name + "-0-start.png") });
  let n = 0;
  for (const step of plan.steps) {
    const before = stats.filter((s) => s.kind === "walk_move").length;
    if (step.tap) await page.tap(".arrow." + step.tap);
    else await swipe(page, step.swipe);
    n++;
    const label = n + "-" + (step.tap ? "tap-" + step.tap : "swipe-" + step.swipe);
    if (step.mid) {
      await sleep(step.mid);
      await page.screenshot({ path: path.join(outDir, name + "-" + label + "-mid.png") });
    }
    const ok = await until(() => stats.filter((s) => s.kind === "walk_move").length > before, 30000);
    if (!ok) errors.push("move " + label + " did not finish in 30 s");
    await page.screenshot({ path: path.join(outDir, name + "-" + label + "-end.png") });
  }
  const load = stats.find((s) => s.kind === "walk_load");
  const moves = stats.filter((s) => s.kind === "walk_move").map((m) => ({ move: m.move, edge: m.edge, reverse: m.reverse, swipe_to_frame_ms: m.swipe_to_frame_ms, fps: m.fps, dropped: m.dropped, total: m.total, wall_s: m.wall_s, error: m.error }));
  results.push({ ...plan, steps: undefined, device: DEVICE, engine: "WebKit (Playwright, software rendering)", ready_ms: readyMs, loaded_bytes: load?.loaded_bytes, load_ms: load?.load_ms, page_fps: load?.page_fps, moves, errors, hud: await page.textContent("#hud") });
  await page.close();
}
await browser.close();
fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
