#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5105);
const STATS = path.join(here, "stats.jsonl");
const CLIPS = path.join(here, "out", "clips");

const mounts = [
  ["/assets/", path.join(here, "assets")],
  ["/worlds/", path.join(here, "worlds")],
  ["/", path.join(here, "web")],
];

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ktx2": "image/ktx2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".svg": "image/svg+xml",
};
const compressible = new Set([".html", ".js", ".mjs", ".json", ".css", ".glb", ".svg"]);

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function resolveFile(urlPath) {
  for (const [prefix, dir] of mounts) {
    if (!urlPath.startsWith(prefix)) continue;
    let rel = decodeURIComponent(urlPath.slice(prefix.length));
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const file = path.resolve(dir, rel);
    if (!file.startsWith(dir + path.sep)) return null;
    return file;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "POST" && url.pathname === "/stats") {
      const body = JSON.parse((await readBody(req, 512 * 1024)).toString("utf8"));
      const entry = { received_at: new Date().toISOString(), user_agent: req.headers["user-agent"] ?? null, ...body };
      fs.appendFileSync(STATS, JSON.stringify(entry) + "\n");
      res.writeHead(204, { "Cache-Control": "no-store" }).end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/frame") {
      const buf = await readBody(req, 20 * 1024 * 1024);
      const session = (url.searchParams.get("session") || "s").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 60);
      const i = String(Number(url.searchParams.get("i") || 0)).padStart(5, "0");
      const dir = path.join(here, "out", "frames", session);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, i + ".jpg"), buf);
      res.writeHead(204).end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/clip") {
      const buf = await readBody(req, 80 * 1024 * 1024);
      const type = String(req.headers["content-type"] || "");
      const ext = type.includes("mp4") ? ".mp4" : type.includes("webm") ? ".webm" : ".bin";
      const name = (url.searchParams.get("name") || "clip").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 60);
      fs.mkdirSync(CLIPS, { recursive: true });
      const file = path.join(CLIPS, new Date().toISOString().replace(/[:.]/g, "-") + "-" + name + ext);
      fs.writeFileSync(file, buf);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ file: path.relative(here, file), bytes: buf.length }));
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    const file = resolveFile(url.pathname);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const stat = fs.statSync(file);
    const headers = {
      "Content-Type": types[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Decoded-Length": String(stat.size),
      "Access-Control-Expose-Headers": "X-Decoded-Length",
      "Timing-Allow-Origin": "*",
    };
    const gzip = compressible.has(ext) && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
    if (gzip) {
      headers["Content-Encoding"] = "gzip";
      headers["Vary"] = "Accept-Encoding";
      res.writeHead(200, headers);
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(file).pipe(zlib.createGzip({ level: 6 })).pipe(res);
      return;
    }
    headers["Content-Length"] = String(stat.size);
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.writeHead(400, { "Content-Type": "text/plain" });
    res.end(String(e?.message ?? e));
  }
});

server.listen(PORT, () => {
  console.log("composite world on http://localhost:" + PORT + "/?day=hackathon (or ?day=santa-cruz); stats -> " + path.relative(process.cwd(), STATS));
});
