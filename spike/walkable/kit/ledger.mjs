import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const walkableRoot = path.resolve(here, "..");
export const budgets = JSON.parse(fs.readFileSync(path.join(here, "budget.json"), "utf8"));

export const ledgerPath = (approach) => path.join(walkableRoot, "ledger", approach + ".jsonl");

export function readLedger(approach) {
  const p = ledgerPath(approach);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export const spent = (approach) => readLedger(approach).reduce((s, e) => s + (e.est_cost_usd || 0), 0);

export function checkBudget(approach, estCostUsd) {
  if (!budgets[approach]) throw new Error("unknown approach '" + approach + "'; known: " + Object.keys(budgets).join(", "));
  if (typeof estCostUsd !== "number" || !(estCostUsd >= 0)) throw new Error("--est (USD) is required; read the model's price first");
  const cap = budgets[approach].cap_usd;
  const before = spent(approach);
  if (before + estCostUsd > cap) throw new Error("budget cap: '" + approach + "' has spent ~$" + before.toFixed(3) + " of $" + cap + "; this call (~$" + estCostUsd + ") would exceed it. Ask your parent before going further.");
}

export function appendLedger(approach, entry) {
  fs.mkdirSync(path.dirname(ledgerPath(approach)), { recursive: true });
  fs.appendFileSync(ledgerPath(approach), JSON.stringify(entry) + "\n");
}

export function charge(approach, { endpoint, label, estCostUsd, note, provider = "manual" }) {
  checkBudget(approach, estCostUsd);
  const entry = { ts: new Date().toISOString(), approach, provider, label, endpoint, kind: "manual", est_cost_usd: estCostUsd, note };
  appendLedger(approach, entry);
  return entry;
}

export function printSpent(approach, all) {
  const names = all ? Object.keys(budgets) : [approach];
  let total = 0;
  for (const n of names) {
    const s = spent(n);
    total += s;
    console.log(n.padEnd(12) + " ~$" + s.toFixed(3) + " of $" + budgets[n].cap_usd + " (" + readLedger(n).length + " calls)");
  }
  if (all) console.log("total".padEnd(12) + " ~$" + total.toFixed(3));
}

export function collectUrls(node, keyPath = [], out = []) {
  if (typeof node === "string") {
    if (/^https?:\/\//.test(node)) out.push({ key: keyPath.join("."), url: node });
  } else if (Array.isArray(node)) node.forEach((v, i) => collectUrls(v, [...keyPath, String(i)], out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) collectUrls(v, [...keyPath, k], out);
  return out;
}

export async function downloadAll(files, outDir, label) {
  let total = 0;
  const seen = new Set();
  for (const [i, f] of files.entries()) {
    if (seen.has(f.url)) continue;
    seen.add(f.url);
    const ext = path.extname(new URL(f.url).pathname) || "";
    const base = (label || "out").replace(/[^a-z0-9._-]+/gi, "_") + "__" + (f.key || String(i)).replace(/[^a-z0-9._-]+/gi, "_") + ext;
    try {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, base), buf);
      f.local = path.relative(process.cwd(), path.join(outDir, base));
      f.bytes = buf.length;
      f.content_type = res.headers.get("content-type");
      total += buf.length;
    } catch (e) {
      f.download_error = String(e?.message ?? e).slice(0, 200);
    }
  }
  return total;
}

export function parseArgs(argv) {
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
