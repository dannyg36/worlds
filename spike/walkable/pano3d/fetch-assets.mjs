#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, "manifest.json"), "utf8"));
const args = process.argv.slice(2);
const onlyDay = args.includes("--day") ? args[args.indexOf("--day") + 1] : null;
const force = args.includes("--force");

const jobs = [];
for (const [day, entry] of Object.entries(manifest.days)) {
  if (onlyDay ? day !== onlyDay : entry.dev) continue;
  for (const [name, file] of Object.entries(entry.files ?? {})) {
    jobs.push({ day, name, url: file.url, bytes: file.bytes, dest: path.join(here, "assets", day, name) });
  }
}

async function fetchOne(job) {
  if (!job.url) return { ...job, status: fs.existsSync(job.dest) ? "local" : "skipped" };
  if (!force && fs.existsSync(job.dest) && (!job.bytes || fs.statSync(job.dest).size === job.bytes)) return { ...job, status: "cached" };
  const res = await fetch(job.url);
  if (!res.ok) throw new Error(res.status + " " + job.url);
  const buf = Buffer.from(await res.arrayBuffer());
  if (job.bytes && buf.length !== job.bytes) throw new Error(job.day + "/" + job.name + ": expected " + job.bytes + " bytes, got " + buf.length);
  fs.mkdirSync(path.dirname(job.dest), { recursive: true });
  fs.writeFileSync(job.dest, buf);
  return { ...job, status: "downloaded", got: buf.length };
}

let failed = 0;
const queue = [...jobs];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const job = queue.shift();
    try {
      const r = await fetchOne(job);
      console.log(r.status.padEnd(11) + (job.day + "/" + job.name).padEnd(44) + ((job.bytes ?? r.got ?? 0) / 1e6).toFixed(2) + " MB");
    } catch (e) {
      failed++;
      console.error("FAILED     " + job.day + "/" + job.name + ": " + (e?.message ?? e));
    }
  }
}));
console.log(jobs.length - failed + "/" + jobs.length + " files in " + path.relative(process.cwd(), path.join(here, "assets")));
if (failed) process.exit(1);
