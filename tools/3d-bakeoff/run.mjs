import { existsSync } from "node:fs";
import { readJson, writeJson, falQueueRun, findGlbUrl, download, reserveSpend, appendJsonl, parseArgs, list, OUT, pool, ledgerTotal, DEFAULT_CAP_USD } from "./lib.mjs";

const args = parseArgs();
const here = (file) => new URL("./" + file, import.meta.url).pathname;
const days = readJson(here("days.json"));
const recipe = readJson(here("recipe.json"));
const concepts = readJson(OUT + (args.concepts ?? "concept") + "/manifest.json", {});
const all = readJson(here("candidates.json"));
const wanted = list(args.candidates);
const candidates = wanted.length ? wanted.map((id) => all.find((c) => c.id === id) ?? (() => { throw new Error("unknown candidate " + id); })()) : [];
const slugs = list(args.days).length ? list(args.days) : Object.keys(days);
const tag = args.tag ?? "matrix";
const cap = Number(args.cap ?? DEFAULT_CAP_USD);
const retries = Number(args.retries ?? 1);
const timeoutMs = Number(args.timeout ?? 600) * 1000;
const textTemplate = "A miniature tabletop diorama of {scene}, on one compact square base.";

const jobs = [];
slugs.forEach((slug, dayIndex) => {
  const rotated = candidates.map((_, i) => candidates[(i + dayIndex) % candidates.length]);
  for (const candidate of rotated) {
    const record = OUT + tag + "/" + candidate.id + "/" + slug + ".json";
    if (!args.force && existsSync(record) && readJson(record).ok) continue;
    jobs.push({ candidate, slug, record });
  }
});

const planned = jobs.reduce((sum, job) => sum + job.candidate.price_usd, 0);
console.log("jobs " + jobs.length + ", planned $" + planned.toFixed(2) + ", ledger $" + ledgerTotal().toFixed(2) + ", cap $" + cap);
if (args["dry-run"]) process.exit(0);
if (ledgerTotal() + planned > cap) throw new Error("planned spend would pass the cap");

function buildInput(candidate, slug) {
  if (candidate.text) {
    let prompt = textTemplate.replace("{scene}", days[slug]);
    if (candidate.max_prompt_chars && prompt.length > candidate.max_prompt_chars) prompt = prompt.slice(0, candidate.max_prompt_chars - 1).replace(/[ ,:;]+\S*$/, "") + ".";
    return { ...candidate.input, prompt };
  }
  const concept = concepts[slug];
  if (!concept) throw new Error("no concept image for " + slug);
  const key = candidate.image_key.replace("[]", "");
  const value = candidate.image_key.endsWith("[]") ? [concept.url] : concept.url;
  return { ...candidate.input, [key]: value };
}

await pool(jobs, Number(args.concurrency ?? 4), async ({ candidate, slug, record }) => {
  const input = buildInput(candidate, slug);
  const attempts = [];
  let final;
  for (let attempt = 0; attempt <= retries; attempt++) {
    reserveSpend({ kind: "3d", tag, candidate: candidate.id, endpoint: candidate.endpoint, day: slug, attempt, est_usd: candidate.price_usd }, cap);
    const started = new Date().toISOString();
    const run = await falQueueRun(candidate.endpoint, input, { timeoutMs });
    const entry = { attempt, started, ok: run.ok, stage: run.stage ?? null, http: run.http ?? null, request_id: run.request_id ?? null, timeline: run.timeline, error: run.ok ? null : JSON.stringify(run.error ?? null).slice(0, 1500) };
    if (run.ok) {
      const glb = findGlbUrl(run.result, candidate.glb_paths);
      if (!glb) {
        entry.ok = false;
        entry.stage = "no_glb";
        entry.error = "no GLB in result keys " + Object.keys(run.result).join(",");
      } else {
        const file = OUT + tag + "/" + candidate.id + "/" + slug + ".glb";
        try {
          const dl = await download(glb.url, file);
          entry.glb = { url: glb.url, path: glb.path, file, bytes: dl.bytes, download_s: dl.seconds };
        } catch (error) {
          entry.ok = false;
          entry.stage = "download";
          entry.error = String(error);
        }
      }
      entry.result = run.result;
    }
    attempts.push(entry);
    appendJsonl(OUT + tag + "/runs.jsonl", { candidate: candidate.id, endpoint: candidate.endpoint, day: slug, ...entry, result: undefined });
    final = entry;
    const wall = entry.timeline?.result_s ?? entry.timeline?.timeout_s;
    console.log([candidate.id, slug, "attempt " + attempt, entry.ok ? "ok" : "FAIL " + entry.stage, wall + "s", entry.glb ? (entry.glb.bytes / 1e6).toFixed(1) + "MB" : "", entry.ok ? "" : String(entry.error).slice(0, 200)].join(" | "));
    if (entry.ok) break;
  }
  writeJson(record, { candidate: candidate.id, family: candidate.family, endpoint: candidate.endpoint, day: slug, input, price_usd: candidate.price_usd, ok: final.ok, attempts });
});
console.log("ledger now $" + ledgerTotal().toFixed(2));
