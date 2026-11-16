import http from "node:http";
import { createReadStream, existsSync, statSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { extname, dirname, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";
import { parseArgs, list, OUT, readJson, writeJson } from "./lib.mjs";

const HERE = new URL("./", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".json": "application/json" };

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const path = url.startsWith("/h/") ? HERE + url.slice(3) : url.startsWith("/f/") ? url.slice(2) : null;
    if (!path || !existsSync(path) || !statSync(path).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
    createReadStream(path).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

export async function openViewer() {
  const server = await serve();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/local/bin/chromium",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-gpu-sandbox"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  await page.goto("http://127.0.0.1:" + server.address().port + "/h/viewer.html");
  await page.waitForFunction(() => window.viewerReady === true, null, { timeout: 60000 });
  return {
    async render(glbPath, { views, size = 768, yaw = 0 } = {}) {
      const info = await page.evaluate(([url, yaw]) => window.loadGlb(url, { yaw }), ["/f" + glbPath, yaw]);
      const out = await page.evaluate(([views, size]) => window.renderViews(views, { size }), [views, size]);
      return { ...info, ...out, images: out.images.map((d) => Buffer.from(d.split(",")[1], "base64")) };
    },
    async close() {
      await browser.close();
      server.close();
    },
  };
}

export const FOUR_VIEWS = [[0, 25], [90, 25], [180, 25], [270, 25]];

if (import.meta.url === "file://" + process.argv[1]) {
  const args = parseArgs();
  const tag = args.tag ?? "matrix";
  const base = OUT + tag + "/";
  const only = list(args.candidates);
  const days = list(args.days);
  const size = Number(args.size ?? 640);
  const turntable = Number(args.turntable ?? 0);
  const yaws = args.yaws ? JSON.parse(args.yaws) : {};
  const files = [];
  for (const cand of readdirSync(base)) {
    if (only.length && !only.includes(cand)) continue;
    const dir = base + cand + "/";
    if (!statSync(base + cand).isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".glb")) continue;
      const day = f.replace(/\.glb$/, "");
      if (days.length && !days.includes(day)) continue;
      const done = dir + day + ".v3.png";
      if (!args.force && !turntable && existsSync(done)) continue;
      files.push({ cand, day, path: dir + f });
    }
  }
  console.log("rendering " + files.length + " GLBs");
  const viewer = await openViewer();
  const timings = readJson(base + "render-timings.json", {});
  for (const { cand, day, path } of files) {
    const t0 = performance.now();
    try {
      const yaw = yaws[cand] ?? 0;
      const r = await viewer.render(path, { views: FOUR_VIEWS, size, yaw });
      r.images.forEach((img, i) => writeFileSync(dirname(path) + "/" + day + ".v" + i + ".png", img));
      if (turntable) {
        const frames = Array.from({ length: turntable }, (_, i) => [(i * 360) / turntable, 25]);
        const t = await viewer.render(path, { views: frames, size: Number(args["turntable-size"] ?? 512), yaw });
        const tmp = OUT + "tmp-frames/";
        rmSync(tmp, { recursive: true, force: true });
        mkdirSync(tmp, { recursive: true });
        t.images.forEach((img, i) => writeFileSync(tmp + String(i).padStart(3, "0") + ".png", img));
        execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "24", "-i", tmp + "%03d.png", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", dirname(path) + "/" + day + ".turntable.mp4"]);
      }
      timings[cand + "/" + day] = { load_ms: r.loadMs, draw_ms: r.drawMs, triangles_drawn: r.triangles, wall_ms: Math.round(performance.now() - t0) };
      console.log(cand, day, "load " + r.loadMs + "ms", "draw " + r.drawMs + "ms", r.triangles + " tris");
    } catch (error) {
      timings[cand + "/" + day] = { error: String(error).slice(0, 300) };
      console.error(cand, day, "render failed", String(error).slice(0, 300));
    }
  }
  writeJson(base + "render-timings.json", timings);
  await viewer.close();
}
