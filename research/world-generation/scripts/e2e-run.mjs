import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { ConvexClient } from "/workspace/worlds/node_modules/convex/dist/esm/browser/index.js";
import { anyApi } from "/workspace/worlds/node_modules/convex/dist/esm/server/index.js";

const OUT = process.env.E2E_OUT ?? "/home/user/.capy/work/e2e/out";
const SAMPLES = "/home/user/.capy/drive/captain-gurnoor-sandu/handoffs/sample-days.md";
const days = readFileSync(SAMPLES, "utf8")
  .split(/^## /m)
  .slice(1)
  .map((block) => {
    const [slug, ...rest] = block.trim().split("\n");
    return { slug: slug.trim(), transcript: rest.join(" ").trim() };
  });
const wanted = process.argv.slice(2);
const selected = wanted.length ? days.filter((day) => wanted.includes(day.slug)) : days;
const concurrency = Number(process.env.E2E_CONCURRENCY ?? 1);

const client = new ConvexClient("http://127.0.0.1:3210");

async function generate(day) {
  const startedAt = Date.now();
  const id = await client.mutation(anyApi.worlds.add, { transcript: day.transcript });
  const transitions = [{ status: "queued", atMs: 0 }];
  const world = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${day.slug} timed out`)), 15 * 60_000);
    const unsubscribe = client.onUpdate(anyApi.worlds.get, { id }, (current) => {
      if (!current) return;
      if (current.status !== transitions.at(-1).status) {
        transitions.push({ status: current.status, atMs: Date.now() - startedAt });
        console.log(`${day.slug}: ${current.status} at ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      }
      if (current.status === "ready" || current.status === "failed") {
        clearTimeout(timer);
        unsubscribe();
        resolve(current);
      }
    });
  });
  const dir = `${OUT}/${day.slug}`;
  mkdirSync(dir, { recursive: true });
  const files = {};
  for (const [name, url] of [["concept.jpg", world.imageUrl], ["world.glb", world.modelUrl]]) {
    if (!url) continue;
    const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
    writeFileSync(`${dir}/${name}`, bytes);
    files[name] = bytes.length;
  }
  const run = JSON.parse(
    execFileSync("npx", ["convex", "run", "--inline-query", `await ctx.db.get(${JSON.stringify(world._id)}).then((w) => ctx.db.get(w.runId))`], { cwd: "/workspace/worlds", encoding: "utf8" }),
  );
  const summary = {
    slug: day.slug,
    transcript: day.transcript,
    status: world.status,
    error: world.error,
    clientMs: transitions.at(-1).atMs,
    transitions,
    scene: run.scene,
    durations: run.durations,
    tasks: run.tasks.map((task) => ({
      step: task.step,
      attempt: task.attempt,
      provider: task.provider,
      model: task.model,
      requestId: task.requestId,
      outcome: task.outcome,
      error: task.error,
      queueMs: task.startedAt ? task.startedAt - task.submittedAt : undefined,
      inferenceMs: task.inferenceMs,
      providerMs: task.completedAt ? task.completedAt - task.submittedAt : undefined,
      storeMs: task.completedAt && task.finishedAt ? task.finishedAt - task.completedAt : undefined,
      totalMs: task.finishedAt ? task.finishedAt - task.submittedAt : undefined,
    })),
    files,
  };
  writeFileSync(`${dir}/scene.json`, JSON.stringify(run.scene ?? null, null, 2));
  writeFileSync(`${dir}/timings.json`, JSON.stringify(summary, null, 2));
  return summary;
}

const results = [];
for (let i = 0; i < selected.length; i += concurrency) {
  results.push(...(await Promise.all(selected.slice(i, i + concurrency).map(generate))));
}
writeFileSync(`${OUT}/summary-${Date.now()}.json`, JSON.stringify(results, null, 2));
for (const r of results) {
  const d = r.durations ?? {};
  console.log([r.slug, r.status, d.dreaming, d.painting, d.sculpting, d.total, r.clientMs, r.files["world.glb"]].join("\t"));
}
await client.close();
