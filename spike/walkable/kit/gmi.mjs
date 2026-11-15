#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendLedger, charge, checkBudget, collectUrls, downloadAll, parseArgs, printSpent } from "./ledger.mjs";

const BASE = (process.env.GMI_BASE_URL || "https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey").replace(/\/$/, "");
const THREE_D_MODELS = new Set(["hunyuan-3d-pro"]);
const LOCK = path.join(os.homedir(), ".capy", "work", "gmi-3d.lock");
const TERMINAL = new Set(["success", "succeeded", "completed", "failed", "error", "cancelled", "canceled"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function headers(json = true) {
  if (!process.env.GMI_API_KEY) throw new Error("GMI_API_KEY is not set on this machine");
  const h = { Authorization: "Bearer " + process.env.GMI_API_KEY };
  if (json) h["Content-Type"] = "application/json";
  if (process.env.GMI_ORG_ID) h["X-Organization-ID"] = process.env.GMI_ORG_ID;
  return h;
}

const BUSY_WAIT_MS = Number(process.env.GMI_BUSY_WAIT_S || 900) * 1000;

async function gmi(method, pathname, body) {
  const url = pathname.startsWith("http") ? pathname : BASE + pathname;
  const t0 = Date.now();
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90000) });
    } catch (e) {
      if (attempt >= 5) throw new Error(method + " " + pathname + " -> " + String(e?.message ?? e));
      await sleep(2000 * attempt);
      continue;
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (res.ok) return json ?? text;
    const busy = /ResourceInsufficient|insufficient|concurren|too many/i.test(text);
    if (busy && Date.now() - t0 < BUSY_WAIT_MS) {
      console.error("[gmi] " + (body?.model ?? pathname) + " busy (HTTP " + res.status + ": " + text.slice(0, 120) + "); retrying in 30s, " + Math.round((BUSY_WAIT_MS - (Date.now() - t0)) / 1000) + "s of patience left");
      await sleep(30000);
      continue;
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 5) throw new Error(method + " " + pathname + " -> HTTP " + res.status + ": " + text.slice(0, 500));
    const ra = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : Math.min(30000, 2000 * 2 ** (attempt - 1)));
  }
}

const requestIdOf = (j) => j?.request_id ?? j?.requestId ?? j?.id ?? j?.data?.request_id ?? j?.data?.id ?? null;
const statusOf = (j) => String(j?.status ?? j?.data?.status ?? "").toLowerCase();

export async function status(requestId) {
  return gmi("GET", "/requests/" + encodeURIComponent(requestId));
}

async function pollUntilDone(requestId, timeoutMs) {
  const t0 = Date.now();
  let processingAt = null;
  let last = null;
  let delay = 2000;
  while (Date.now() - t0 < timeoutMs) {
    last = await status(requestId);
    const s = statusOf(last);
    if (!processingAt && s && s !== "queued" && s !== "pending") processingAt = Date.now();
    if (TERMINAL.has(s)) return { final: last, processingAt };
    await sleep(delay);
    delay = Math.min(5000, delay + 500);
  }
  const err = new Error("timed out after " + Math.round(timeoutMs / 1000) + "s waiting for " + requestId + " (last status: " + statusOf(last) + "); the job may still be running on GMI");
  err.timedOut = true;
  throw err;
}

async function acquire3dLock() {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  const t0 = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(LOCK, "wx");
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString(), request_id: null }));
      fs.closeSync(fd);
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    let held = {};
    try { held = JSON.parse(fs.readFileSync(LOCK, "utf8")); } catch {}
    const age = Date.now() - Date.parse(held.started_at || 0);
    let alive = false;
    try { process.kill(held.pid, 0); alive = true; } catch {}
    if (held.request_id) {
      const s = statusOf(await status(held.request_id).catch(() => null));
      if (TERMINAL.has(s) || (!alive && !s)) { fs.rmSync(LOCK, { force: true }); continue; }
    } else if (!alive || age > 10 * 60 * 1000) { fs.rmSync(LOCK, { force: true }); continue; }
    if (Date.now() - t0 > 40 * 60 * 1000) throw new Error("waited 40 min for the 3D lock at " + LOCK + "; another 3D job is still in flight");
    console.error("[gmi] another 3D job is in flight (" + (held.request_id || "submitting") + "); waiting for it to finish");
    await sleep(10000);
  }
}

function update3dLock(requestId) {
  try {
    const held = JSON.parse(fs.readFileSync(LOCK, "utf8"));
    if (held.pid === process.pid) fs.writeFileSync(LOCK, JSON.stringify({ ...held, request_id: requestId }));
  } catch {}
}

function release3dLock(keep) {
  if (keep) return;
  try {
    const held = JSON.parse(fs.readFileSync(LOCK, "utf8"));
    if (held.pid === process.pid) fs.rmSync(LOCK, { force: true });
  } catch {}
}

export async function run({ approach, model, payload, estCostUsd, label = "", outDir = null, timeoutS = null, is3d = null }) {
  checkBudget(approach, estCostUsd);
  headers();
  const threeD = is3d ?? (THREE_D_MODELS.has(model) || /3d/i.test(model));
  const timeoutMs = (timeoutS ?? (threeD ? 1800 : 900)) * 1000;
  if (threeD) await acquire3dLock();
  const t0 = Date.now();
  let requestId = null;
  let final = null;
  let processingAt = null;
  let error = null;
  let timedOut = false;
  try {
    const submitted = await gmi("POST", "/requests", { model, payload });
    requestId = requestIdOf(submitted);
    if (!requestId) throw new Error("no request id in submit response: " + JSON.stringify(submitted).slice(0, 400));
    if (threeD) update3dLock(requestId);
    ({ final, processingAt } = await pollUntilDone(requestId, timeoutMs));
    const s = statusOf(final);
    if (s !== "success" && s !== "succeeded" && s !== "completed") error = "status " + s + ": " + JSON.stringify(final?.outcome ?? final?.error ?? final).slice(0, 600);
  } catch (e) {
    error = String(e?.message ?? e).slice(0, 900);
    timedOut = !!e?.timedOut;
  } finally {
    if (threeD) release3dLock(timedOut);
  }
  const t1 = Date.now();
  const outcome = final?.outcome ?? null;
  const files = outcome ? collectUrls(outcome) : [];
  const outputBytes = outDir && files.length ? await downloadAll(files, outDir, label) : 0;
  const entry = {
    ts: new Date(t0).toISOString(),
    approach,
    provider: "gmi",
    label,
    endpoint: model,
    request_id: requestId,
    status: error ? "error" : "ok",
    error,
    latency_s: +((t1 - t0) / 1000).toFixed(2),
    queue_wait_s: processingAt ? +((processingAt - t0) / 1000).toFixed(2) : null,
    est_cost_usd: requestId ? estCostUsd : 0,
    output_bytes: outputBytes || null,
    files,
  };
  appendLedger(approach, entry);
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, (label || "out").replace(/[^a-z0-9._-]+/gi, "_") + ".result.json"), JSON.stringify({ entry, model, payload, final }, null, 2));
  }
  if (error) throw new Error(model + " failed: " + error);
  return { final, outcome, files, entry };
}

export async function upload(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const types = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", mp4: "video/mp4", mp3: "audio/mpeg", wav: "audio/wav" };
  if (!types[ext]) throw new Error("GMI upload accepts jpeg, jpg, png, mp4, mp3, wav; got ." + ext);
  const { upload_url, public_url } = await gmi("POST", "/upload-url", { file_type: ext });
  const res = await fetch(upload_url, { method: "PUT", headers: { "Content-Type": types[ext] }, body: fs.readFileSync(filePath) });
  if (!res.ok) throw new Error("upload PUT -> HTTP " + res.status + ": " + (await res.text()).slice(0, 300));
  return public_url;
}

export const listModels = () => gmi("GET", "/models");
export const modelInfo = (id) => gmi("GET", "/models/" + encodeURIComponent(id));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  try {
    if (cmd === "run") {
      const payload = args["payload-file"] ? JSON.parse(fs.readFileSync(args["payload-file"], "utf8")) : JSON.parse(args.payload ?? "{}");
      const { entry } = await run({ approach: args.approach, model: args.model, payload, estCostUsd: Number(args.est), label: args.label ?? "", outDir: args.out ?? null, timeoutS: args["timeout-s"] ? Number(args["timeout-s"]) : null, is3d: args["3d"] ? true : null });
      console.log(JSON.stringify(entry, null, 2));
    } else if (cmd === "status") {
      console.log(JSON.stringify(await status(args._[1]), null, 2));
    } else if (cmd === "upload") {
      console.log(await upload(args._[1]));
    } else if (cmd === "models") {
      console.log(JSON.stringify(await listModels(), null, 2));
    } else if (cmd === "model") {
      const info = await modelInfo(args._[1]);
      if (args.out) fs.writeFileSync(args.out, JSON.stringify(info, null, 2));
      console.log(JSON.stringify(info, null, 2));
    } else if (cmd === "charge") {
      console.log(JSON.stringify(charge(args.approach, { endpoint: args.endpoint, label: args.label ?? "", estCostUsd: Number(args.est), note: args.note ?? "" })));
    } else if (cmd === "spent") {
      printSpent(args.approach, !!args.all);
    } else {
      console.log([
        "usage:",
        "  node gmi.mjs run --approach <name> --model <model id> --est <usd> [--label x] [--out dir] [--timeout-s N] [--3d] (--payload '{json}' | --payload-file f.json)",
        "  node gmi.mjs status <request_id>",
        "  node gmi.mjs upload <file.png|jpg|mp4>      # returns a stable public URL",
        "  node gmi.mjs models                          # model ids your key can call",
        "  node gmi.mjs model <id> [--out f.json]       # schema and parameters for one model",
        "  node gmi.mjs charge --approach <name> --endpoint <id> --est <usd> --note '...'",
        "  node gmi.mjs spent (--approach <name> | --all)",
      ].join("\n"));
    }
  } catch (e) {
    console.error(String(e?.message ?? e));
    process.exit(1);
  }
}
