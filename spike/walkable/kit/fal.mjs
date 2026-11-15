#!/usr/bin/env node
import { fal } from "@fal-ai/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendLedger, charge, checkBudget, downloadAll, parseArgs, printSpent } from "./ledger.mjs";

function configure() {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is not set on this machine");
  fal.config({ credentials: process.env.FAL_KEY });
}

function collectFiles(node, keyPath = [], out = []) {
  if (Array.isArray(node)) node.forEach((v, i) => collectFiles(v, [...keyPath, String(i)], out));
  else if (node && typeof node === "object") {
    if (typeof node.url === "string" && /^https?:\/\//.test(node.url)) out.push({ key: keyPath.join("."), url: node.url });
    for (const [k, v] of Object.entries(node)) if (k !== "url") collectFiles(v, [...keyPath, k], out);
  }
  return out;
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
  const outputBytes = outDir && files.length ? await downloadAll(files, outDir, label) : 0;
  const entry = {
    ts: new Date(t0).toISOString(), approach, provider: "fal", label, endpoint, request_id: requestId,
    status: error ? "error" : "ok", error,
    latency_s: +((t1 - t0) / 1000).toFixed(2),
    queue_wait_s: startedAt ? +((startedAt - t0) / 1000).toFixed(2) : null,
    est_cost_usd: error && !requestId ? 0 : estCostUsd,
    output_bytes: outputBytes || null, files,
  };
  appendLedger(approach, entry);
  if (outDir && data) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, (label || "out").replace(/[^a-z0-9._-]+/gi, "_") + ".result.json"), JSON.stringify({ entry, input, data }, null, 2));
  }
  if (error) throw new Error(endpoint + " failed: " + error);
  return { data, entry };
}

export async function upload(filePath) {
  configure();
  const types = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".glb": "model/gltf-binary" };
  const type = types[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  return fal.storage.upload(new Blob([fs.readFileSync(filePath)], { type }));
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
      console.log(JSON.stringify(charge(args.approach, { endpoint: args.endpoint, label: args.label ?? "", estCostUsd: Number(args.est), note: args.note ?? "", provider: "fal" })));
    } else if (cmd === "spent") {
      printSpent(args.approach, !!args.all);
    } else {
      console.log("fal is deferred (provider is GMI for now; see gmi.mjs).\nusage:\n  node fal.mjs run --approach <name> --endpoint <id> --est <usd> [--label x] [--out dir] (--input '{json}' | --input-file f.json) [--logs]\n  node fal.mjs upload <file>\n  node fal.mjs spent (--approach <name> | --all)");
    }
  } catch (e) {
    console.error(String(e?.message ?? e));
    process.exit(1);
  }
}
