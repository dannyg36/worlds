#!/usr/bin/env node
import { fal } from "@fal-ai/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const walkableRoot = path.resolve(here, "..");
const budgets = JSON.parse(fs.readFileSync(path.join(here, "budget.json"), "utf8"));

export const ledgerPath = (approach) => path.join(walkableRoot, "ledger", approach + ".jsonl");

export function readLedger(approach) {
  const p = ledgerPath(approach);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export const spent = (approach) => readLedger(approach).reduce((s, e) => s + (e.est_cost_usd || 0), 0);

export function charge(approach, { endpoint, label, estCostUsd, note }) {
  const entry = { ts: new Date().toISOString(), approach, label, endpoint, kind: "manual", est_cost_usd: estCostUsd, note };
  checkBudget(approach, estCostUsd);
  fs.mkdirSync(path.dirname(ledgerPath(approach)), { recursive: true });
  fs.appendFileSync(ledgerPath(approach), JSON.stringify(entry) + "\n");
  return entry;
}

export function checkBudget(approach, estCostUsd) {
  if (!budgets[approach]) throw new Error("unknown approach '" + approach + "'; known: " + Object.keys(budgets).join(", "));
  if (typeof estCostUsd !== "number" || !(estCostUsd >= 0)) throw new Error("estCostUsd is required; read the price in https://fal.ai/models/<endpoint>/llms.txt");
  const cap = budgets[approach].cap_usd;
  const before = spent(approach);
  if (before + estCostUsd > cap) throw new Error("budget cap: '" + approach + "' has spent ~$" + before.toFixed(3) + " of $" + cap + "; this call (~$" + estCostUsd + ") would exceed it. Ask your parent before going further.");
}

function configure() {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is not set on this machine");
  fal.config({ credentials: process.env.FAL_KEY });
}

function collectFiles(node, keyPath = [], out = []) {
  if (Array.isArray(node)) node.forEach((v, i) => collectFiles(v, [...keyPath, String(i)], out));
  else if (node && typeof node === "object") {
    if (typeof node.url === "string" && /^https?:\/\//.test(node.url)) {
      out.push({ key: keyPath.join("."), url: node.url, content_type: node.content_type ?? null, file_name: node.file_name ?? null, file_size: node.file_size ?? null });
    }
    for (const [k, v] of Object.entries(node)) if (k !== "url") collectFiles(v, [...keyPath, k], out);
  }
  return out;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("download " + res.status + " " + url);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}

export async function run({ approach, endpoint, input, estCostUsd, label = "", outDir = null, logs = false }) {
  checkBudget(approach, estCostUsd);
  configure();
  const t0 = Date.now();
  let requestId = null;
  let startedAt = null;
  let data = null;
  let error = null;
  try {
    const result = await fal.subscribe(endpoint, {
      input,
      logs,
      onEnqueue: (id) => { requestId = id; },
      onQueueUpdate: (u) => {
        if (u.status === "IN_PROGRESS" && !startedAt) startedAt = Date.now();
        if (logs && u.logs) for (const l of u.logs) console.error("[" + endpoint + "] " + l.message);
      },
    });
    data = result.data;
    requestId = result.requestId ?? requestId;
  } catch (e) {
    const detail = e?.body?.detail ? " " + JSON.stringify(e.body.detail).slice(0, 600) : "";
    error = (String(e?.message ?? e) + detail).slice(0, 900);
  }
  const t1 = Date.now();
  const files = data ? collectFiles(data) : [];
  let outputBytes = 0;
  if (outDir && files.length) {
    for (const [i, f] of files.entries()) {
      const ext = path.extname(new URL(f.url).pathname) || "";
      const base = (label || "out").replace(/[^a-z0-9._-]+/gi, "_") + "__" + (f.key || i).replace(/[^a-z0-9._-]+/gi, "_") + ext;
      try {
        f.local = path.relative(process.cwd(), path.join(outDir, base));
        f.bytes = await download(f.url, path.join(outDir, base));
        outputBytes += f.bytes;
      } catch (e) {
        f.download_error = String(e?.message ?? e).slice(0, 200);
      }
    }
  }
  const entry = {
    ts: new Date(t0).toISOString(),
    approach,
    label,
    endpoint,
    request_id: requestId,
    status: error ? "error" : "ok",
    error,
    latency_s: +((t1 - t0) / 1000).toFixed(2),
    queue_wait_s: startedAt ? +((startedAt - t0) / 1000).toFixed(2) : null,
    est_cost_usd: error && !requestId ? 0 : estCostUsd,
    output_bytes: outputBytes || null,
    files,
  };
  fs.mkdirSync(path.dirname(ledgerPath(approach)), { recursive: true });
  fs.appendFileSync(ledgerPath(approach), JSON.stringify(entry) + "\n");
  if (outDir && data) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, (label || "out").replace(/[^a-z0-9._-]+/gi, "_") + ".result.json"), JSON.stringify({ entry, input, data }, null, 2));
  }
  if (error) throw new Error(endpoint + " failed: " + error);
  return { data, entry };
}

export async function upload(filePath) {
  configure();
  const types = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".glb": "model/gltf-binary", ".ply": "application/octet-stream", ".json": "application/json" };
  const type = types[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  return fal.storage.upload(new Blob([fs.readFileSync(filePath)], { type }));
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[k] = v;
    } else args._.push(a);
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  try {
    if (cmd === "run") {
      const input = args["input-file"] ? JSON.parse(fs.readFileSync(args["input-file"], "utf8")) : JSON.parse(args.input ?? "{}");
      const { entry } = await run({ approach: args.approach, endpoint: args.endpoint, input, estCostUsd: Number(args.est), label: args.label ?? "", outDir: args.out ?? null, logs: !!args.logs });
      console.log(JSON.stringify(entry, null, 2));
    } else if (cmd === "upload") {
      console.log(await upload(args._[1]));
    } else if (cmd === "charge") {
      console.log(JSON.stringify(charge(args.approach, { endpoint: args.endpoint, label: args.label ?? "", estCostUsd: Number(args.est), note: args.note ?? "" })));
    } else if (cmd === "spent") {
      const names = args.all ? Object.keys(budgets) : [args.approach];
      let total = 0;
      for (const n of names) {
        const s = spent(n);
        total += s;
        console.log(n.padEnd(12) + " ~$" + s.toFixed(3) + " of $" + budgets[n].cap_usd + " (" + readLedger(n).length + " calls)");
      }
      if (args.all) console.log("total".padEnd(12) + " ~$" + total.toFixed(3));
    } else {
      console.log("usage:\n  node fal.mjs run --approach <name> --endpoint <id> --est <usd> [--label x] [--out dir] (--input '{json}' | --input-file f.json) [--logs]\n  node fal.mjs upload <file>\n  node fal.mjs charge --approach <name> --endpoint <id> --est <usd> --note 'realtime session 120s'\n  node fal.mjs spent (--approach <name> | --all)");
    }
  } catch (e) {
    console.error(String(e?.message ?? e));
    process.exit(1);
  }
}
