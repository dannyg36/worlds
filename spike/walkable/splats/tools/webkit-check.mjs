#!/usr/bin/env node
// WebKit stand-in for the phone while cloud phones are down: Playwright WebKit with iPhone emulation against the local server.
// Records load time, whether the splats rendered, console errors, drag-to-look and stick-to-walk, and screenshots.
// Desktop WebKit on a CPU-only machine renders WebGL in software, so its FPS is not phone FPS.
//   npx playwright install --with-deps webkit && node tools/webkit-check.mjs [outDir]   (server must be running on BASE)
import fs from "node:fs";
import { webkit, devices } from "playwright";

const base = process.env.BASE || "http://localhost:5103/";
const out = process.argv[2] || "work/webkit";
const deviceName = process.env.DEVICE || "iPhone 15 Pro";
const days = (process.env.DAYS || "hackathon,santa-cruz").split(",");
fs.mkdirSync(out, { recursive: true });

const diff = async (page, a, b) =>
  page.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const c = new OffscreenCanvas(64, 64), x = c.getContext("2d");
    x.drawImage(ia, 0, 0, 64, 64); const da = x.getImageData(0, 0, 64, 64).data;
    x.drawImage(ib, 0, 0, 64, 64); const db = x.getImageData(0, 0, 64, 64).data;
    let s = 0; for (let k = 0; k < da.length; k += 4) s += Math.abs(da[k] - db[k]) + Math.abs(da[k + 1] - db[k + 1]) + Math.abs(da[k + 2] - db[k + 2]);
    return +(s / (64 * 64 * 3)).toFixed(2);
  }, [a, b]);
const dataUrl = (buf) => "data:image/png;base64," + buf.toString("base64");

const browser = await webkit.launch();
const results = [];
for (const day of days) {
  const context = await browser.newContext({ ...devices[deviceName] });
  const page = await context.newPage();
  const log = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") log.push(m.type() + ": " + m.text().slice(0, 300)); });
  page.on("pageerror", (e) => log.push("pageerror: " + String(e.message).slice(0, 300)));
  const r = { day, device: deviceName, browser: "WebKit " + browser.version() + " (software GL)" };
  const t0 = Date.now();
  try {
    await page.goto(base + "?day=" + day + "&run=webkit", { waitUntil: "load" });
    r.pageLoadS = (Date.now() - t0) / 1000;
    await page.waitForFunction(() => document.getElementById("loading")?.classList.contains("done"), null, { timeout: 180000 });
    r.firstSortedFrameS = (Date.now() - t0) / 1000;
    await page.waitForTimeout(4000);
    const shot0 = await page.screenshot({ path: out + "/" + day + "-start.png" });
    r.webgl = await page.evaluate(() => { const g = document.createElement("canvas").getContext("webgl2"); const e = g && g.getExtension("WEBGL_debug_renderer_info"); return g ? (e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) : "no webgl2"; });
    const vp = page.viewportSize();
    await page.mouse.move(vp.width * 0.6, vp.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(vp.width * 0.25, vp.height * 0.35, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(2500);
    const shot1 = await page.screenshot({ path: out + "/" + day + "-look.png" });
    r.lookChange = await diff(page, dataUrl(shot0), dataUrl(shot1));
    const box = await page.locator("#stick").boundingBox();
    if (box) {
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy - box.height * 0.45, { steps: 6 });
      await page.waitForTimeout(3000);
      await page.mouse.up();
      await page.waitForTimeout(1500);
      const shot2 = await page.screenshot({ path: out + "/" + day + "-walk.png" });
      r.walkChange = await diff(page, dataUrl(shot1), dataUrl(shot2));
    }
    const hudBtn = page.getByRole("button", { name: "HUD" });
    const hb = await hudBtn.boundingBox();
    if (hb) {
      const before = await page.locator("#hud").getAttribute("class");
      await page.touchscreen.tap(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.waitForTimeout(300);
      r.tapTogglesHud = before !== (await page.locator("#hud").getAttribute("class"));
    }
    r.hud = (await page.locator("#hud").innerText()).split("\n").slice(0, 12);
  } catch (e) {
    r.error = String(e.message || e).split("\n")[0];
    await page.screenshot({ path: out + "/" + day + "-error.png" }).catch(() => {});
  }
  r.consoleErrors = log.slice(0, 20);
  results.push(r);
  console.log(JSON.stringify(r));
  await context.close();
}
await browser.close();
fs.writeFileSync(out + "/webkit-check.json", JSON.stringify(results, null, 2) + "\n");
