#!/usr/bin/env node
// Deterministic demo capture: drives web/ in headless Chromium (SwiftShader) one fixed timestep at a time and stitches an MP4.
// usage: node capture.mjs "http://localhost:5102/?day=hackathon&mode=depth" out.mp4 [--fps 24] [--dpr 2]
// needs: npm i puppeteer-core (in this folder or NODE_PATH), ffmpeg, and Chromium at $CHROMIUM (default /usr/local/bin/chromium).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const [url, out] = process.argv.slice(2);
const arg = (k, d) => (process.argv.includes("--" + k) ? Number(process.argv[process.argv.indexOf("--" + k) + 1]) : d);
const fps = arg("fps", 24), dpr = arg("dpr", 2), maxFrames = arg("max", 600);
if (!url || !out) throw new Error("usage: node capture.mjs <page url> <out.mp4>");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pano3d-cap-"));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM || "/usr/local/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const t0 = Date.now();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  await page.goto(url + (url.includes("?") ? "&" : "?") + "capture=1&hud=0", { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction("window.__ready === true", { timeout: 180000 });
  await page.evaluate(() => window.__demo());
  let i = 0;
  for (; i < maxFrames; i++) {
    const running = await page.evaluate((ms) => window.__step(ms), 1000 / fps);
    await page.screenshot({ path: path.join(dir, "f_" + String(i).padStart(4, "0") + ".jpg"), type: "jpeg", quality: 90 });
    if (!running) break;
  }
  console.log(i + 1 + " frames in " + ((Date.now() - t0) / 1000).toFixed(0) + " s");
} finally {
  await browser.close();
}
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", path.join(dir, "f_%04d.jpg"), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-movflags", "+faststart", out]);
fs.rmSync(dir, { recursive: true, force: true });
console.log(out + " " + (fs.statSync(out).size / 1e6).toFixed(2) + " MB");
