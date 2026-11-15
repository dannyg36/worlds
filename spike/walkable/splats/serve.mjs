#!/usr/bin/env node
// Static server for the splats prototype. No dependencies, no build step.
//   node spike/walkable/splats/serve.mjs            (PORT defaults to 5103)
// GET  /...            files under spike/walkable/splats/ (index.html at /), with Range and gzip support
// POST /stats          JSON body, appended as one line to stats.jsonl
// POST /clip?name=x    raw video body from the in-page recorder, saved under recordings/
// GET  /stats.jsonl    the stats log so far
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5103);
const statsPath = path.join(root, "stats.jsonl");
const clipsDir = path.join(root, "recordings");

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};
const compressible = new Set([".html", ".js", ".mjs", ".json", ".jsonl", ".css", ".md", ".svg", ".ply"]);
const gzCache = new Map();

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(body);
}

async function handleStats(req, res) {
  const body = await readBody(req, 512 * 1024);
  let data;
  try {
    data = JSON.parse(body.toString("utf8"));
  } catch {
    return send(res, 400, "bad json");
  }
  const line = { server_ts: new Date().toISOString(), ua: req.headers["user-agent"] ?? null, ...data };
  fs.appendFileSync(statsPath, JSON.stringify(line) + "\n");
  send(res, 204, "");
}

async function handleClip(req, res, url) {
  const name = (url.searchParams.get("name") || "clip").replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80);
  const ext = (req.headers["content-type"] || "").includes("mp4") ? ".mp4" : ".webm";
  const body = await readBody(req, 200 * 1024 * 1024);
  fs.mkdirSync(clipsDir, { recursive: true });
  const file = path.join(clipsDir, new Date().toISOString().replace(/[:.]/g, "-") + "_" + name + ext);
  fs.writeFileSync(file, body);
  fs.appendFileSync(statsPath, JSON.stringify({ server_ts: new Date().toISOString(), event: "clip", file: path.relative(root, file), bytes: body.length }) + "\n");
  send(res, 200, JSON.stringify({ file: path.relative(root, file), bytes: body.length }), { "Content-Type": "application/json" });
}

function serveFile(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep)) return send(res, 403, "forbidden");
  if (/(^|\/)\.|node_modules|\.venv/.test(path.relative(root, file))) return send(res, 404, "not found");
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return send(res, 404, "not found");
  }
  if (st.isDirectory()) return send(res, 404, "not found");
  const ext = path.extname(file).toLowerCase();
  const etag = '"' + st.size.toString(16) + "-" + Math.floor(st.mtimeMs).toString(16) + '"';
  const headers = {
    "Content-Type": types[ext] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
    ETag: etag,
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, X-Raw-Length",
    "X-Raw-Length": String(st.size),
  };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range) {
    let start = range[1] === "" ? st.size - Number(range[2]) : Number(range[1]);
    let end = range[1] !== "" && range[2] !== "" ? Number(range[2]) : st.size - 1;
    if (start < 0) start = 0;
    if (end >= st.size) end = st.size - 1;
    if (start > end) return send(res, 416, "bad range", { "Content-Range": "bytes */" + st.size });
    res.writeHead(206, { ...headers, "Content-Length": end - start + 1, "Content-Range": "bytes " + start + "-" + end + "/" + st.size });
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  const wantsGzip = compressible.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] || "") && st.size > 1024;
  if (wantsGzip) {
    const key = file + etag;
    let gz = gzCache.get(key);
    if (!gz) {
      gz = zlib.gzipSync(fs.readFileSync(file), { level: 6 });
      gzCache.set(key, gz);
    }
    res.writeHead(200, { ...headers, "Content-Encoding": "gzip", "Content-Length": gz.length, Vary: "Accept-Encoding" });
    return res.end(req.method === "HEAD" ? undefined : gz);
  }
  res.writeHead(200, { ...headers, "Content-Length": st.size });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "OPTIONS") {
      return send(res, 204, "", { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, HEAD", "Access-Control-Allow-Headers": "Content-Type" });
    }
    if (req.method === "POST" && url.pathname === "/stats") return await handleStats(req, res);
    if (req.method === "POST" && url.pathname === "/clip") return await handleClip(req, res, url);
    if (req.method === "GET" || req.method === "HEAD") return serveFile(req, res, url);
    send(res, 405, "method not allowed");
  } catch (e) {
    send(res, e.status || 500, String(e.message || e));
  }
});

server.listen(port, () => {
  console.log("splats prototype on http://localhost:" + port + "/?day=hackathon  (stats -> " + path.relative(process.cwd(), statsPath) + ")");
});
