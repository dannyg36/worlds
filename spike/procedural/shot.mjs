#!/usr/bin/env node
// Headless screenshots of the diorama page.
// node shot.mjs "<query>" <out.png> ["<query>" <out.png> ...]
// e.g. node shot.mjs "gallery=people&size=900" out/people.png
//      node shot.mjs "scene=birthday-dinner.hand&size=1024&yaw=0" out/bd.png
// Also: node shot.mjs --serve  (prints a URL and keeps serving, for a real browser)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".glb": "model/gltf-binary" };

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || !fs.statSync(p).isFile()) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": types[path.extname(p)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(Number(process.env.PORT ?? 0), "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

const args = process.argv.slice(2);
if (args[0] === "--serve") {
  console.log(base + "?scene=birthday-dinner.hand");
} else {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  });
  try {
    for (let i = 0; i < args.length; i += 2) {
      const query = args[i], out = args[i + 1];
      const size = Number(new URLSearchParams(query).get("size") ?? 1024);
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      const logs = [];
      page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(m.text()); });
      page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
      const t = Date.now();
      await page.goto(`${base}?${query}&still=1`);
      try {
        await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
      } catch {
        console.error("timeout", query, logs.join("\n"));
        await page.close();
        continue;
      }
      const stats = await page.evaluate(() => window.stats);
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      await page.screenshot({ path: out });
      console.log(JSON.stringify({ out, ms: Date.now() - t, ...stats }));
      if (logs.length) console.log("console:", logs.slice(0, 15).join("\n"));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}
