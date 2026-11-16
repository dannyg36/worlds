import { webkit, devices } from "playwright";
import fs from "node:fs";
const base = process.argv[2] || "http://localhost:5101/";
const out = process.argv[3] || "out";
fs.mkdirSync(out, { recursive: true });
const dev = devices["iPhone 15 Pro"];
const browser = await webkit.launch();
const results = [];
const shot = (page, name) => page.screenshot({ path: out + "/" + name + ".png" });
const hudText = (page) => page.evaluate(() => document.getElementById("hud").textContent);
for (const day of ["hackathon", "santa-cruz"]) {
  const ctx = await browser.newContext({ ...dev });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  const t0 = Date.now();
  await page.goto(base + "?day=" + day + "&spin=0", { waitUntil: "load" });
  await page.waitForFunction(() => /TTFF \d/.test(document.getElementById("hud")?.textContent || ""), null, { timeout: 180000 });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(4000);
  const orbitHud = await hudText(page);
  await shot(page, "webkit-" + day + "-orbit");
  await page.tap("#modes button[data-mode=stand]");
  await page.waitForTimeout(2500);
  const vp = page.viewportSize();
  const b0 = await page.screenshot();
  await page.mouse.move(vp.width * 0.75, vp.height * 0.3);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(vp.width * 0.75 - i * 10, vp.height * 0.3); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const b1 = await page.screenshot();
  await page.mouse.move(vp.width * 0.2, vp.height - 190);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(vp.width * 0.2, vp.height - 190 - i * 8); await page.waitForTimeout(40); }
  await page.waitForTimeout(2500);
  await page.mouse.up();
  await page.waitForTimeout(1000);
  const b2 = await page.screenshot();
  await shot(page, "webkit-" + day + "-stand-table");
  const standHud = await hudText(page);
  await page.tap("#scales button[data-scale=life]");
  await page.waitForTimeout(3000);
  await shot(page, "webkit-" + day + "-stand-life");
  const lifeHud = await hudText(page);
  results.push({
    day,
    load_ms_to_first_frame: loadMs,
    look_drag_changed_view: Buffer.compare(b0, b1) !== 0,
    joystick_changed_view: Buffer.compare(b1, b2) !== 0,
    stand_tap_ok: /stand\/table/.test(standHud),
    life_tap_ok: /stand\/life/.test(lifeHud),
    errors,
    orbit_hud: orbitHud.split("\n"),
    life_hud_fps: lifeHud.split("\n")[0],
  });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify({ device: "Playwright WebKit, devices['iPhone 15 Pro'] emulation (software GL)", viewport: dev.viewport, dpr: dev.deviceScaleFactor, ua: dev.userAgent, results }, null, 2));
