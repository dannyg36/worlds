#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5102);
const statsPath = path.join(here, "stats.jsonl");
const clipsDir = path.join(here, "clips");

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".ply": "application/octet-stream",
  ".drc": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".u16": "application/octet-stream",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};
const gzipTypes = new Set([".js", ".mjs", ".json", ".html", ".glb", ".ply", ".bin", ".u16"]);
const gzCache = new Map();

const routes = [
  ["/web/", path.join(here, "web")],
  ["/assets/", path.join(here, "assets")],
];

function resolveFile(urlPath) {
  if (urlPath === "/" || urlPath === "/index.html") return path.join(here, "web", "index.html");
  if (urlPath === "/manifest.json") return path.join(here, "manifest.json");
  for (const [prefix, dir] of routes) {
    if (!urlPath.startsWith(prefix)) continue;
    const file = path.resolve(dir, "." + decodeURIComponent(urlPath.slice(prefix.length - 1)));
    return file.startsWith(dir + path.sep) ? file : null;
  }
  return null;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "POST" && url.pathname === "/stats") {
      const body = JSON.parse((await readBody(req, 256 * 1024)).toString("utf8"));
      const line = { server_ts: new Date().toISOString(), ua: req.headers["user-agent"] ?? null, ...body };
      fs.appendFileSync(statsPath, JSON.stringify(line) + "\n");
      return send(res, 204, "");
    }
    if (req.method === "POST" && url.pathname === "/clip") {
      const body = await readBody(req, 80 * 1024 * 1024);
      const type = String(req.headers["content-type"] || "");
      const ext = type.includes("mp4") ? ".mp4" : type.includes("webm") ? ".webm" : ".bin";
      const name = (url.searchParams.get("name") || "clip").replace(/[^a-z0-9._-]+/gi, "_").slice(0, 60);
      fs.mkdirSync(clipsDir, { recursive: true });
      const file = path.join(clipsDir, new Date().toISOString().replace(/[:.]/g, "-") + "-" + name + ext);
      fs.writeFileSync(file, body);
      fs.appendFileSync(statsPath, JSON.stringify({ server_ts: new Date().toISOString(), event: "clip", file: path.relative(here, file), bytes: body.length, type }) + "\n");
      return send(res, 200, JSON.stringify({ file: path.relative(here, file), bytes: body.length }), { "Content-Type": "application/json" });
    }
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed");
    const file = resolveFile(url.pathname);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, "not found: " + url.pathname);
    const ext = path.extname(file).toLowerCase();
    const stat = fs.statSync(file);
    const headers = { "Content-Type": types[ext] ?? "application/octet-stream", "Access-Control-Allow-Origin": "*", "Timing-Allow-Origin": "*" };
    if (gzipTypes.has(ext) && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""))) {
      const key = file + ":" + stat.mtimeMs;
      if (!gzCache.has(key)) gzCache.set(key, zlib.gzipSync(fs.readFileSync(file), { level: 6 }));
      const gz = gzCache.get(key);
      return send(res, 200, req.method === "HEAD" ? "" : gz, { ...headers, "Content-Encoding": "gzip", "Content-Length": gz.length, "X-Raw-Length": stat.size });
    }
    res.writeHead(200, { "Cache-Control": "no-store", ...headers, "Content-Length": stat.size });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, 400, String(e?.message ?? e));
  }
});

server.listen(PORT, () => console.log("pano3d on http://localhost:" + PORT + "/?day=hackathon (stats -> " + path.relative(process.cwd(), statsPath) + ")"));
