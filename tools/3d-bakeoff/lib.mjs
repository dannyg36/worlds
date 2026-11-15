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
  return readJsonl(LEDGER).reduce((sum, row) => sum + row.est_usd, 0);
}

export function reserveSpend(entry, capUsd = DEFAULT_CAP_USD) {
  const total = ledgerTotal();
  if (total + entry.est_usd > capUsd) {
    throw new Error("spend cap reached: ledger " + total.toFixed(3) + " + " + entry.est_usd + " > cap " + capUsd);
  }
  appendJsonl(LEDGER, { ts: new Date().toISOString(), ...entry });
}

export function getPath(obj, path) {
  return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), obj);
}

export function pickModelUrl(urls, result, preferredPaths = []) {
  for (const path of preferredPaths) {
    const url = getPath(result, path);
    if (typeof url === "string") return url;
  }
  const clean = (u) => u.split("?")[0].toLowerCase();
  return urls.find((u) => clean(u).endsWith(".glb")) ?? urls.find((u) => /\.(gltf|zip|obj|fbx|usdz)$/.test(clean(u))) ?? urls[0] ?? null;
}

export async function download(url, path) {
  const t0 = performance.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error("download " + res.status + " " + url.split("?")[0]);
  const buf = Buffer.from(await res.arrayBuffer());
  ensureDir(dirname(path));
  writeFileSync(path, buf);
  return { bytes: buf.length, seconds: Number(((performance.now() - t0) / 1000).toFixed(3)), magic: buf.subarray(0, 4).toString("latin1"), content_type: res.headers.get("content-type") };
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
