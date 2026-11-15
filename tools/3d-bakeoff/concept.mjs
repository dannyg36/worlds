import { readJson, writeJson, download, reserveSpend, appendJsonl, parseArgs, list, OUT, pool } from "./lib.mjs";
import { runJob } from "./providers.mjs";

const args = parseArgs();
const days = readJson(new URL("./days.json", import.meta.url).pathname);
const recipe = readJson(args.recipe ?? new URL("./recipe.json", import.meta.url).pathname);
const provider = args.provider ?? recipe.provider;
const model = args.model ?? recipe.model;
const input = { ...recipe.input, ...(args.input ? JSON.parse(args.input) : {}) };
const price = Number(args.price ?? recipe.price_usd);
const outDir = OUT + (args.out ?? "concept") + "/";
const slugs = list(args.days).length ? list(args.days) : Object.keys(days);
const manifestPath = outDir + "manifest.json";
const manifest = readJson(manifestPath, {});

await pool(slugs, Number(args.concurrency ?? 2), async (slug) => {
  const prompt = recipe.template.replace("{scene}", days[slug]);
  reserveSpend({ kind: "concept", provider, model, day: slug, est_usd: price });
  const run = await runJob(provider, model, { ...input, prompt }, { pollMs: 500, timeoutMs: Number(args.timeout ?? 300) * 1000 });
  appendJsonl(outDir + "runs.jsonl", { slug, provider, model, ok: run.ok, stage: run.stage ?? null, timeline: run.timeline, server: run.server ?? null, error: run.ok ? null : JSON.stringify(run.error ?? null).slice(0, 800) });
  if (!run.ok) {
    console.error(slug, "failed", run.stage, JSON.stringify(run.error ?? "").slice(0, 300));
    return;
  }
  const url = run.urls[0];
  const ext = (url.split("?")[0].match(/\.(png|jpe?g|webp)$/i)?.[1] ?? "png").toLowerCase();
  const file = outDir + slug + "." + ext;
  const dl = await download(url, file);
  manifest[slug] = { url, file, bytes: dl.bytes, prompt, provider, model, input, latency_s: run.timeline.result_s, request_id: run.request_id };
  console.log(slug, run.timeline.result_s + "s", (dl.bytes / 1e6).toFixed(2) + "MB", url.split("?")[0]);
});
writeJson(manifestPath, manifest);
