#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5101);
const statsPath = path.join(root, "stats.jsonl");
const clipsDir = path.join(root, "clips");

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

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

async function handlePost(req, res, url) {
  if (url.pathname === "/stats") {
    const body = await readBody(req, 512 * 1024);
    let stats;
    try {
      stats = JSON.parse(body.toString("utf8"));
    } catch {
      res.writeHead(400).end("invalid json");
      return;
    }
    const line = { received_at: new Date().toISOString(), user_agent: req.headers["user-agent"] ?? null, ...stats };
    fs.appendFileSync(statsPath, JSON.stringify(line) + "\n");
    res.writeHead(204).end();
    return;
  }
  if (url.pathname === "/clip") {
    const body = await readBody(req, 80 * 1024 * 1024);
    const ext = String(req.headers["content-type"] ?? "").includes("mp4") ? ".mp4" : ".webm";
    const name = (url.searchParams.get("name") ?? "clip").replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80);
    fs.mkdirSync(clipsDir, { recursive: true });
    const file = path.join(clipsDir, name + "-" + Date.now() + ext);
    fs.writeFileSync(file, body);
    console.log("clip saved " + path.relative(root, file) + " " + body.length + " bytes");
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ file: path.relative(root, file), bytes: body.length }));
    return;
  }
  res.writeHead(404).end("not found");
}

function serveFile(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(root, rel));
  const type = types[path.extname(file).toLowerCase()];
  if (!file.startsWith(root + path.sep) || !type || path.basename(file).startsWith(".")) {
    res.writeHead(404).end("not found");
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    const isAsset = file.startsWith(path.join(root, "assets") + path.sep);
    res.writeHead(200, {
      "content-type": type,
      "content-length": st.size,
      "cache-control": isAsset ? "public, max-age=3600" : "no-cache",
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST") {
      handlePost(req, res, url).catch((e) => {
        if (!res.headersSent) res.writeHead(500).end(String(e?.message ?? e));
      });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    serveFile(req, res, url);
  })
  .listen(port, "0.0.0.0", () => {
    console.log("skybox prototype on http://localhost:" + port + "/?day=hackathon (stats -> " + path.relative(process.cwd(), statsPath) + ")");
  });
