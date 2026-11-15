import { readJson, writeJson, falQueueRun, download, reserveSpend, appendJsonl, parseArgs, list, OUT, pool } from "./lib.mjs";

const args = parseArgs();
const days = readJson(new URL("./days.json", import.meta.url).pathname);
const recipe = readJson(args.recipe ?? new URL("./recipe.json", import.meta.url).pathname);
const model = args.model ?? recipe.model;
const input = { ...recipe.input, ...(args.input ? JSON.parse(args.input) : {}) };
const price = Number(args.price ?? recipe.price_usd);
const outDir = OUT + (args.out ?? "concept") + "/";
const slugs = list(args.days).length ? list(args.days) : Object.keys(days);
const manifestPath = outDir + "manifest.json";
const manifest = readJson(manifestPath, {});

await pool(slugs, Number(args.concurrency ?? 4), async (slug) => {
  const prompt = recipe.template.replace("{scene}", days[slug]);
  reserveSpend({ kind: "concept", endpoint: model, day: slug, est_usd: price });
  const run = await falQueueRun(model, { ...input, prompt });
  appendJsonl(outDir + "runs.jsonl", { slug, model, ok: run.ok, timeline: run.timeline, error: run.error ?? null });
  if (!run.ok) {
    console.error(slug, "failed", run.stage, JSON.stringify(run.error ?? "").slice(0, 300));
    return;
  }
  const image = run.result.images?.[0];
  const file = outDir + slug + ".png";
  await download(image.url, file);
  manifest[slug] = { url: image.url, file, width: image.width, height: image.height, prompt, model, input, seed: run.result.seed ?? input.seed, latency_s: run.timeline.result_s };
  console.log(slug, run.timeline.result_s + "s", image.url);
});
writeJson(manifestPath, manifest);
