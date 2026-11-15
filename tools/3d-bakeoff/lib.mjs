import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const OUT = new URL("./out/", import.meta.url).pathname;
export const LEDGER = OUT + "ledger.jsonl";
export const DEFAULT_CAP_USD = Number(process.env.BAKEOFF_CAP_USD ?? 45);

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export function appendJsonl(path, value) {
  ensureDir(dirname(path));
  appendFileSync(path, JSON.stringify(value) + "\n");
}

export function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

export function ledgerTotal() {
  return readJsonl(LEDGER).reduce((sum, row) => sum + (row.charged === false ? 0 : row.est_usd), 0);
}

export function reserveSpend(entry, capUsd = DEFAULT_CAP_USD) {
  const total = ledgerTotal();
  if (total + entry.est_usd > capUsd) {
    throw new Error("fal spend cap reached: ledger " + total.toFixed(3) + " + " + entry.est_usd + " > cap " + capUsd);
  }
  appendJsonl(LEDGER, { ts: new Date().toISOString(), ...entry });
}

function falKey() {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not set");
  return key;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function falFetch(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: "Key " + falKey(), "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 2000) };
  }
  return { status: res.status, ok: res.ok, body };
}

export async function falQueueRun(endpoint, input, { timeoutMs = 600_000, pollMs = 500 } = {}) {
  const t0 = performance.now();
  const at = () => Number(((performance.now() - t0) / 1000).toFixed(3));
  const timeline = { submitted_at: new Date().toISOString() };
  const submit = await falFetch("https://queue.fal.run/" + endpoint, { method: "POST", body: JSON.stringify(input) });
  timeline.submit_ack_s = at();
  if (!submit.ok) {
    return { ok: false, stage: "submit", http: submit.status, error: submit.body, timeline };
  }
  const { request_id, status_url, response_url, cancel_url } = submit.body;
  timeline.request_id = request_id;
  let last;
  while (true) {
    if (performance.now() - t0 > timeoutMs) {
      await falFetch(cancel_url, { method: "PUT" }).catch(() => {});
      timeline.timeout_s = at();
      return { ok: false, stage: "timeout", request_id, timeline };
    }
    const status = await falFetch(status_url);
    if (status.ok) {
      last = status.body;
      if (last.status === "IN_QUEUE" && timeline.first_queue_position === undefined) {
        timeline.first_queue_position = last.queue_position ?? null;
      }
      if (last.status === "IN_PROGRESS" && timeline.in_progress_s === undefined) timeline.in_progress_s = at();
      if (last.status === "COMPLETED") {
        timeline.completed_s = at();
        if (timeline.in_progress_s === undefined) timeline.in_progress_s = null;
        timeline.inference_time_s = last.metrics?.inference_time ?? null;
        break;
      }
    }
    await sleep(pollMs);
  }
  const result = await falFetch(response_url);
  timeline.result_s = at();
  if (!result.ok || result.body?.detail) {
    return { ok: false, stage: "result", http: result.status, request_id, error: result.body, timeline };
  }
  return { ok: true, request_id, result: result.body, timeline };
}

export function getPath(obj, path) {
  return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), obj);
}

export function findGlbUrl(result, preferredPaths = []) {
  for (const path of preferredPaths) {
    const url = getPath(result, path);
    if (typeof url === "string") return { url, path };
  }
  const stack = [{ value: result, path: "" }];
  while (stack.length) {
    const { value, path } = stack.pop();
    if (value && typeof value === "object") {
      if (typeof value.url === "string" && (/\.glb(\?|$)/i.test(value.url) || value.content_type === "model/gltf-binary")) {
        return { url: value.url, path: path + ".url" };
      }
      for (const [key, child] of Object.entries(value)) stack.push({ value: child, path: path ? path + "." + key : key });
    }
  }
  return null;
}

export async function download(url, path) {
  const t0 = performance.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error("download " + res.status + " " + url);
  const buf = Buffer.from(await res.arrayBuffer());
  ensureDir(dirname(path));
  writeFileSync(path, buf);
  return { bytes: buf.length, seconds: Number(((performance.now() - t0) / 1000).toFixed(3)) };
}

export async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    args[key] = value;
  }
  return args;
}

export const list = (value) => (typeof value === "string" ? value.split(",").map((s) => s.trim()).filter(Boolean) : []);
