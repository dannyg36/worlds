import { existsSync } from "node:fs";
import { readJson, writeJson, pickModelUrl, download, reserveSpend, appendJsonl, parseArgs, list, OUT, LEDGER, pool, ledgerTotal, DEFAULT_CAP_USD } from "./lib.mjs";
import { runJob } from "./providers.mjs";

const args = parseArgs();
const here = (file) => new URL("./" + file, import.meta.url).pathname;
const days = readJson(here("days.json"));
const concepts = readJson(OUT + (args.concepts ?? "concept") + "/manifest.json", {});
const all = readJson(here("candidates.json"));
const candidates = list(args.candidates).map((id) => all.find((c) => c.id === id) ?? (() => { throw new Error("unknown candidate " + id); })());
const slugs = list(args.days).length ? list(args.days) : Object.keys(days);
const tag = args.tag ?? "matrix";
const cap = Number(args.cap ?? DEFAULT_CAP_USD);
const retries = Number(args.retries ?? 0);
const timeoutMs = Number(args.timeout ?? 900) * 1000;
const textTemplate = "A miniature tabletop diorama of {scene}, on one compact square base.";

function buildInput(candidate, slug) {
  if (candidate.mode === "text") {
    let prompt = textTemplate.replace("{scene}", days[slug]);
    if (candidate.max_prompt_chars && prompt.length > candidate.max_prompt_chars) prompt = prompt.slice(0, candidate.max_prompt_chars - 1).replace(/[ ,:;]+\S*$/, "") + ".";
    return { ...candidate.input, prompt };
  }
  const concept = concepts[slug];
  if (!concept) throw new Error("no concept image for " + slug);
  const key = candidate.image_key.replace("[]", "");
  return { ...candidate.input, [key]: candidate.image_key.endsWith("[]") ? [concept.url] : concept.url };
}

const jobs = [];
for (let round = 0; round < Number(args.repeat ?? 1); round++) {
  slugs.forEach((slug, dayIndex) => {
    const rotated = candidates.map((_, i) => candidates[(i + dayIndex + round) % candidates.length]);
    for (const candidate of rotated) {
      const suffix = round ? "~r" + round : "";
      const record = OUT + tag + "/" + candidate.id + "/" + slug + suffix + ".json";
      if (!args.force && existsSync(record) && readJson(record).ok) continue;
      jobs.push({ candidate, slug, suffix, record });
    }
  });
}

const planned = jobs.reduce((sum, job) => sum + job.candidate.price_usd, 0);
console.log("jobs " + jobs.length + ", planned $" + planned.toFixed(2) + ", ledger $" + ledgerTotal().toFixed(2) + ", cap $" + cap);
if (args["dry-run"]) {
  for (const candidate of candidates) console.log(candidate.id, candidate.provider, candidate.model, JSON.stringify(buildInput(candidate, slugs[0])).slice(0, 400));
  process.exit(0);
}
if (ledgerTotal() + planned > cap) throw new Error("planned spend would pass the cap");

let halted = null;
await pool(jobs, Number(args.concurrency ?? 1), async ({ candidate, slug, suffix, record }) => {
  if (halted) return;
  const input = buildInput(candidate, slug);
  const attempts = [];
  let final;
  for (let attempt = 0; attempt <= retries; attempt++) {
    reserveSpend({ kind: "3d", tag, candidate: candidate.id, provider: candidate.provider, model: candidate.model, day: slug + suffix, attempt, est_usd: candidate.price_usd }, cap);
    const started = new Date().toISOString();
    const run = await runJob(candidate.provider, candidate.model, input, { timeoutMs, pollMs: Number(args.poll ?? 1000) });
    const entry = { attempt, started, ok: run.ok, stage: run.stage ?? null, http: run.http ?? null, request_id: run.request_id ?? null, timeline: run.timeline, server: run.server ?? null, error: run.ok ? null : JSON.stringify(run.error ?? run.last_status ?? null).slice(0, 1500) };
    if (!run.ok && run.stage === "submit") appendJsonl(LEDGER, { ts: new Date().toISOString(), kind: "refund", tag, candidate: candidate.id, provider: candidate.provider, model: candidate.model, day: slug + suffix, attempt, est_usd: -candidate.price_usd, reason: "submit rejected without a request id" });
    if (!run.ok && (run.stage === "submit" || /insufficient|quota|rate.?limit/i.test(entry.error))) halted = candidate.id + " " + slug + suffix + ": " + entry.error;
    if (run.ok) {
      entry.urls = run.urls;
      const url = pickModelUrl(run.urls, run.result, candidate.glb_paths);
      if (!url) {
        entry.ok = false;
        entry.stage = "no_model_url";
      } else {
        const ext = url.split("?")[0].match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "bin";
        const file = OUT + tag + "/" + candidate.id + "/" + slug + suffix + "." + (ext === "glb" ? "glb" : "raw." + ext);
        try {
          const dl = await download(url, file);
          entry.model_file = { url: url.split("?")[0], file, bytes: dl.bytes, download_s: dl.seconds, magic: dl.magic, content_type: dl.content_type };
        } catch (error) {
          entry.ok = false;
          entry.stage = "download";
          entry.error = String(error);
        }
      }
      entry.result = run.result;
    }
    attempts.push(entry);
    appendJsonl(OUT + tag + "/runs.jsonl", { candidate: candidate.id, provider: candidate.provider, model: candidate.model, day: slug + suffix, ...entry, result: undefined });
    final = entry;
    const t = entry.timeline ?? {};
    const wall = t.result_s ?? t.timeout_s ?? t.failed_s;
    const proc = t.processing_s != null && t.result_s != null ? (t.result_s - t.processing_s).toFixed(1) + "s processing" : "";
    console.log([candidate.id, slug + suffix, "attempt " + attempt, entry.ok ? "ok" : "FAIL " + entry.stage, wall + "s from submit", proc, entry.model_file ? (entry.model_file.bytes / 1e6).toFixed(1) + "MB " + entry.model_file.magic : "", entry.ok ? "" : String(entry.error).slice(0, 200)].join(" | "));
    if (entry.ok || halted) break;
  }
  writeJson(record, { candidate: candidate.id, provider: candidate.provider, model: candidate.model, day: slug + suffix, input, price_usd: candidate.price_usd, ok: final.ok, attempts });
});
console.log("ledger now $" + ledgerTotal().toFixed(2));
if (halted) {
  console.error("HALT, no further submissions: " + halted.slice(0, 300));
  process.exitCode = 2;
}
