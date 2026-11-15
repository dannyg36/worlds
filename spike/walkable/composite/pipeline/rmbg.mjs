#!/usr/bin/env node
// Background removal through GMI's bria-image-remove-background (RMBG 2.0, $0.018/image), one call per image,
// all in parallel, through the spike kit (budget + ledger).
//   node pipeline/rmbg.mjs --day hackathon --set gmi-objects-front [--only a,b] [--sheet]
import fs from "node:fs";
import path from "node:path";
import { run } from "../../kit/gmi.mjs";
import { assetsDir, readWorld } from "./worldfile.mjs";

export async function removeBackground(imageUrl, label, outDir) {
  const r = await run({ approach: "composite", model: "bria-image-remove-background", payload: { image: imageUrl }, estCostUsd: 0.018, label, outDir, timeoutS: 240 });
  const f = r.files.find((x) => x.local);
  return { local: path.resolve(f.local), url: f.url, entry: r.entry };
}

if (process.argv[1]?.endsWith("rmbg.mjs")) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith("--")) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
  }
  const dir = path.join(assetsDir, args.day, args.set);
  const results = fs.readdirSync(dir).filter((f) => f.endsWith(".result.json"));
  const jobs = [];
  for (const f of results) {
    const res = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const id = res.entry.label.split("-").pop();
    if (args.only && !String(args.only).split(",").includes(id)) continue;
    const url = res.entry.files[0].url;
    jobs.push(removeBackground(url, args.day + "-" + args.set + "-rmbg-" + id, path.join(dir, "rmbg")).then((r) => {
      const dest = path.join(dir, "rmbg", id + ".png");
      fs.copyFileSync(r.local, dest);
      console.log(id.padEnd(11), r.entry.latency_s + "s", "queue " + r.entry.queue_wait_s + "s", dest);
      return r;
    }).catch((e) => console.error(id, "FAILED", String(e.message).slice(0, 200))));
  }
  const t0 = Date.now();
  await Promise.all(jobs);
  console.log("wall", ((Date.now() - t0) / 1000).toFixed(1) + "s for", jobs.length, "images");
}
