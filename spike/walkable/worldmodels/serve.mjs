#!/usr/bin/env node
// worlds walkable spike, approach "worldmodels": serves the phone page and a guarded fal WMA proxy.
//
//   node spike/walkable/worldmodels/serve.mjs          (PORT defaults to 5104)
//
// The browser opens WebRTC sessions with @fal-ai/client's wma() extension through POST /api/fal/proxy.
// FAL_KEY stays in this process. Guardrails, because anyone with the URL can reach this server:
//   - only the WMA bridge routes (/ice, /session, /session/heartbeat) and fal.run/<model>/ice are
//     forwarded, and only for the world-model endpoints in models.json;
//   - every session is reserved in the spike ledger (kit charge()) before it opens and settled after;
//   - new sessions are refused past the spend cap (budget.json cap minus $1 by default) and past
//     WM_MAX_CONCURRENT (2) live sessions;
//   - a session is capped at 120 s (less where models.json says so): after that the proxy refuses its
//     heartbeats, which ends the bridge lease; the page also sends {type:"stop"} and closes at the cap.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const walkable = path.resolve(here, "..");
const require = createRequire(import.meta.url);

let proxyLib;
let kit;
try {
  proxyLib = require("@fal-ai/server-proxy");
  kit = await import("../kit/fal.mjs");
} catch (e) {
  console.error("Dependencies are missing. Run `node spike/walkable/worldmodels/fetch-assets.mjs` first.\n" + e.message);
  process.exit(1);
}

const APPROACH = "worldmodels";
const { models } = JSON.parse(fs.readFileSync(path.join(here, "models.json"), "utf8"));
const budget = JSON.parse(fs.readFileSync(path.join(walkable, "kit", "budget.json"), "utf8"))[APPROACH];
const PORT = Number(process.env.PORT || 5104);
const SPEND_CAP_USD = Math.min(budget.cap_usd, Number(process.env.WM_SPEND_CAP_USD || budget.cap_usd - 1));
const SESSION_CAP_S = Math.min(120, Number(process.env.WM_SESSION_CAP_S || 120));
const MAX_CONCURRENT = Number(process.env.WM_MAX_CONCURRENT || 2);
const LEASE_GRACE_S = 10;
const HEARTBEAT_GONE_MS = 15000;
const DROP_HEARTBEATS_AFTER_S = Number(process.env.WM_DROP_HEARTBEATS_AFTER_S || 0);
const MAX_UPLOAD_FILES = 200;

const proxyConfig = proxyLib.resolveProxyConfig({
  allowedUrlPatterns: Object.keys(models).map((id) => `fal.run/${id}/ice`),
  serviceHosts: ["wma.fal.run"],
  allowedEndpoints: Object.keys(models).flatMap((id) => [id, `${id}/ice`]),
  allowUnauthorizedRequests: true,
  isAuthenticated: async () => true,
  resolveFalAuth: async () => (process.env.FAL_KEY ? `Key ${process.env.FAL_KEY}` : undefined),
});

const sessions = new Map();
let negotiating = 0;
const round = (n) => Math.round(n * 1e5) / 1e5;
const liveSessions = () => [...sessions.values()].filter((s) => !s.settled);

function sendJson(res, status, obj) {
  if (res.headersSent) return res.end();
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
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

const safeJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

function parseTarget(raw) {
  let url;
  try {
    url = new URL(String(raw || ""));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  if (url.host === "wma.fal.run") {
    const kind = { "/ice": "ice", "/session": "session", "/session/heartbeat": "heartbeat" }[url.pathname];
    return kind ? { kind } : null;
  }
  const m = url.host === "fal.run" ? /^\/(.+)\/ice$/.exec(url.pathname) : null;
  return m && models[m[1]] ? { kind: "app-ice", endpoint: m[1] } : null;
}

function forward(req, res, body, onResponse) {
  return proxyLib.handleRequest(
    {
      id: "worldmodels-node",
      method: req.method,
      getRequestBody: async () => body,
      getHeaders: () => req.headers,
      getHeader: (name) => req.headers[name.toLowerCase()],
      sendHeader: (name, value) => res.setHeader(name, value),
      respondWith: (status, data) => sendJson(res, status, typeof data === "string" ? { error: data } : data),
      sendResponse: async (response) => {
        const text = await response.text();
        if (onResponse) onResponse(response.status, text);
        res.statusCode = response.status;
        res.end(text);
      },
    },
    proxyConfig,
  );
}

function ledgerAppend(entry) {
  fs.mkdirSync(path.dirname(kit.ledgerPath(APPROACH)), { recursive: true });
  fs.appendFileSync(kit.ledgerPath(APPROACH), JSON.stringify(entry) + "\n");
}

function settle(s, seconds, reason) {
  if (s.settled) return;
  s.settled = true;
  const model = models[s.endpoint];
  const billable = seconds > 0 ? Math.max(seconds, model.min_billable_s) : 0;
  const cost = round(Math.min(s.reserve, billable * model.price_usd_per_s));
  const entry = {
    ts: new Date().toISOString(),
    approach: APPROACH,
    label: "settle:" + s.label,
    endpoint: s.endpoint,
    kind: "session-settle",
    session_id: s.id ?? null,
    est_cost_usd: round(cost - s.reserve),
    reserved_usd: s.reserve,
    settled_cost_usd: cost,
    session_seconds_est: round(seconds),
    negotiate_s: s.negotiateMs != null ? round(s.negotiateMs / 1000) : null,
    heartbeats_forwarded: s.beats ?? 0,
    heartbeats_refused: s.refused ?? 0,
    ended_reason: reason,
    note: "seconds = last forwarded heartbeat - answer + " + LEASE_GRACE_S + " s lease grace; cost = max(seconds, min billable) x list price",
  };
  ledgerAppend(entry);
  console.log(`[session] settled ${s.endpoint} ${s.id ?? "-"} ${entry.session_seconds_est}s ~$${cost} (${reason})`);
}

async function openSession(req, res, body, json) {
  const model = models[json.app_id];
  if (liveSessions().length + negotiating >= MAX_CONCURRENT) {
    return sendJson(res, 429, { error: `this server allows ${MAX_CONCURRENT} live world sessions at once; try again shortly` });
  }
  const capS = Math.min(SESSION_CAP_S, model.max_session_s);
  const reserve = round(Math.max(capS, model.min_billable_s) * model.price_usd_per_s);
  const spent = kit.spent(APPROACH);
  if (spent + reserve > SPEND_CAP_USD) {
    return sendJson(res, 402, { error: `spend cap reached: ~$${spent.toFixed(2)} of $${SPEND_CAP_USD} used; no new sessions` });
  }
  const label = String(req.headers["x-wm-label"] || "session").replace(/[^a-z0-9:._-]/gi, "").slice(0, 80) || "session";
  try {
    kit.charge(APPROACH, {
      endpoint: json.app_id,
      label: "reserve:" + label,
      estCostUsd: reserve,
      note: `WMA session reserve: ${capS} s cap x $${model.price_usd_per_s}/s (settled after the session ends)`,
    });
  } catch (e) {
    return sendJson(res, 402, { error: String(e.message || e) });
  }
  const s = { id: null, endpoint: json.app_id, label, reserve, capS, startedAt: null, lastBeat: null, beats: 0, refused: 0, settled: false };
  const t0 = Date.now();
  negotiating++;
  try {
    await forward(req, res, body, (status, text) => {
      s.negotiateMs = Date.now() - t0;
      const answer = status === 200 ? safeJson(text) : null;
      if (!answer?.session_id) {
        settle(s, 0, `negotiation-http-${status}: ${String(text).slice(0, 160)}`);
        return;
      }
      s.id = answer.session_id;
      s.startedAt = s.lastBeat = Date.now();
      sessions.set(s.id, s);
      console.log(`[session] open ${s.endpoint} ${s.id} after ${(s.negotiateMs / 1000).toFixed(1)}s (${label}, cap ${capS}s)`);
    });
  } catch (e) {
    settle(s, 0, "proxy-error: " + String(e.message || e).slice(0, 160));
    sendJson(res, 502, { error: "upstream error" });
  } finally {
    negotiating--;
    if (!s.id && !s.settled) settle(s, 0, "negotiation-no-answer");
  }
}

async function heartbeat(req, res, body, json) {
  const s = json && sessions.get(json.session_id);
  if (!s || s.settled) return sendJson(res, 410, { error: "unknown or ended session" });
  const ageS = (Date.now() - s.startedAt) / 1000;
  if (ageS > s.capS) {
    s.refused++;
    s.capHitAt ??= Date.now();
    return sendJson(res, 410, { error: `session cap of ${s.capS} s reached` });
  }
  if (DROP_HEARTBEATS_AFTER_S && ageS > DROP_HEARTBEATS_AFTER_S) {
    s.refused++;
    s.capHitAt ??= Date.now();
    req.socket.destroy();
    return;
  }
  s.beats++;
  await forward(req, res, body, (status) => {
    if (status === 200) s.lastBeat = Date.now();
  });
}

async function handleProxy(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
  if (!process.env.FAL_KEY) return sendJson(res, 503, { error: "FAL_KEY is not set on this server; live sessions are off (replay still works)" });
  const target = parseTarget(req.headers["x-fal-target-url"]);
  if (!target) return sendJson(res, 403, { error: "target not allowed by the worldmodels proxy" });
  const body = (await readBody(req, 256 * 1024)).toString("utf8");
  const json = safeJson(body);
  if ((target.kind === "ice" || target.kind === "session") && !(json && typeof json.app_id === "string" && models[json.app_id])) {
    return sendJson(res, 403, { error: "app_id not in the worldmodels allowlist" });
  }
  if (target.kind === "session") return openSession(req, res, body, json);
  if (target.kind === "heartbeat") return heartbeat(req, res, body, json);
  return forward(req, res, body);
}

setInterval(() => {
  const now = Date.now();
  for (const s of liveSessions()) {
    if (now - s.lastBeat > HEARTBEAT_GONE_MS) {
      settle(s, (s.lastBeat - s.startedAt) / 1000 + LEASE_GRACE_S, s.capHitAt ? "server-cap-heartbeats-refused" : "client-closed");
    }
  }
}, 2000).unref();

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { error: "not found" });
    const headers = { "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "accept-ranges": "bytes", "cache-control": "no-cache" };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) {
        res.writeHead(416, { "content-range": `bytes */${st.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${st.size}`, "content-length": end - start + 1 });
      if (req.method === "HEAD") return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, "content-length": st.size });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function inside(root, rel) {
  let decoded;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  const file = path.resolve(root, "." + path.posix.normalize("/" + decoded));
  return file.startsWith(root + path.sep) ? file : null;
}

function uploadName(raw, fallback) {
  return (String(raw || fallback).replace(/[^a-z0-9._-]/gi, "_").slice(0, 100) || fallback).replace(/^\.+/, "");
}

async function saveUpload(req, res, dir, ext, limit) {
  fs.mkdirSync(dir, { recursive: true });
  if (fs.readdirSync(dir).length >= MAX_UPLOAD_FILES) return sendJson(res, 507, { error: "upload folder is full" });
  const url = new URL(req.url, "http://x");
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${uploadName(url.searchParams.get("name"), "upload")}${ext}`);
  const buf = await readBody(req, limit);
  fs.writeFileSync(file, buf);
  sendJson(res, 200, { saved: path.relative(here, file), bytes: buf.length });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  try {
    if (p === "/api/fal/proxy") return await handleProxy(req, res);
    if (p === "/stats" && req.method === "POST") {
      const body = safeJson((await readBody(req, 256 * 1024)).toString("utf8"));
      if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(res, 400, { error: "JSON object expected" });
      fs.appendFileSync(path.join(here, "stats.jsonl"), JSON.stringify({ received_at: new Date().toISOString(), ...body }) + "\n");
      return sendJson(res, 200, { ok: true });
    }
    if (p === "/snap" && req.method === "POST") return await saveUpload(req, res, path.join(here, "captures"), ".jpg", 6 * 1024 * 1024);
    if (p === "/clip" && req.method === "POST") {
      const type = String(req.headers["content-type"] || "");
      const ext = type.includes("mp4") ? ".mp4" : type.includes("quicktime") ? ".mov" : ".webm";
      return await saveUpload(req, res, path.join(here, "recordings"), ext, 120 * 1024 * 1024);
    }
    if (p === "/api/status") {
      return sendJson(res, 200, {
        fal_key: !!process.env.FAL_KEY,
        spent_usd: round(kit.spent(APPROACH)),
        spend_cap_usd: SPEND_CAP_USD,
        session_cap_s: SESSION_CAP_S,
        max_concurrent: MAX_CONCURRENT,
        live: liveSessions().map((s) => ({ endpoint: s.endpoint, age_s: Math.round((Date.now() - s.startedAt) / 1000), cap_s: s.capS })),
        negotiating,
      });
    }
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "method not allowed" });
    if (p === "/" || p === "/index.html") return serveFile(req, res, path.join(here, "public", "index.html"));
    if (p === "/scenes.json" || p === "/inputs.json") return serveFile(req, res, path.join(walkable, p.slice(1)));
    if (p === "/models.json" || p === "/manifest.json") return serveFile(req, res, path.join(here, p.slice(1)));
    for (const [prefix, dir] of [["/assets/", "assets"], ["/recordings/", "recordings"], ["/captures/", "captures"]]) {
      if (p.startsWith(prefix)) {
        const file = inside(path.join(here, dir), p.slice(prefix.length));
        return file ? serveFile(req, res, file) : sendJson(res, 404, { error: "not found" });
      }
    }
    const file = inside(path.join(here, "public"), p.slice(1));
    return file ? serveFile(req, res, file) : sendJson(res, 404, { error: "not found" });
  } catch (e) {
    console.error("[error]", req.method, p, e?.message || e);
    sendJson(res, 500, { error: "server error" });
  }
});

function shutdown() {
  for (const s of liveSessions()) settle(s, (Date.now() - s.startedAt) / 1000 + LEASE_GRACE_S, "server-shutdown");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, () => {
  console.log(`worldmodels spike on http://localhost:${PORT}/?day=hackathon`);
  console.log(`FAL_KEY ${process.env.FAL_KEY ? "set" : "missing (replay only)"}; spend ~$${kit.spent(APPROACH).toFixed(3)} of $${SPEND_CAP_USD} server cap; session cap ${SESSION_CAP_S}s; max ${MAX_CONCURRENT} live`);
});
