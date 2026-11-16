import { writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { call, show, redact, QUEUE } from "./gmi.mjs";
export async function runQueue(model, payload, { pollMs = 500, timeoutMs = 120000, label = model, outDir = "/home/user/.capy/work/probe/out" } = {}) {
  mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  const submit = await call("POST", `${QUEUE}/requests`, { model, payload }, 60000);
  const timeline = [{ at: submit.ms, status: submit.json?.status ?? `http ${submit.status}` }];
  const requestId = submit.json?.request_id;
  if (!requestId) return { label, model, submit, timeline };
  let last;
  let polls = 0;
  while (Date.now() - t0 < timeoutMs) {
    const r = await call("GET", `${QUEUE}/requests/${requestId}`, undefined, 30000);
    polls++;
    last = r;
    const status = r.json?.status ?? `http ${r.status}`;
    if (status !== timeline.at(-1).status) timeline.push({ at: Date.now() - t0, status });
    if (["success", "failed", "cancelled", "canceled", "error"].includes(status)) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  const j = last?.json ?? {};
  const outcome = j.outcome;
  const files = [];
  const urls = [];
  const collect = (v) => { if (typeof v === "string" && /^https?:/.test(v)) urls.push(v); else if (Array.isArray(v)) v.forEach(collect); else if (v && typeof v === "object") Object.values(v).forEach(collect); };
  collect(outcome);
  for (const [i, url] of urls.entries()) {
    const d0 = Date.now();
    const res = await fetch(url);
    const bytes = Buffer.from(await res.arrayBuffer());
    const name = `${label.replace(/[^a-z0-9.-]/gi, "_")}-${i}${(new URL(url).pathname.match(/\.[a-z0-9]+$/i) ?? [""])[0]}`;
    writeFileSync(`${outDir}/${name}`, bytes);
    files.push({ name, url: url.replace(/\?.*$/, "?…"), status: res.status, bytes: bytes.length, contentType: res.headers.get("content-type"), downloadMs: Date.now() - d0, magic: bytes.subarray(0, 4).toString("latin1") });
  }
  return { label, model, requestId, submitStatus: submit.status, submitBody: submit.json, totalMs: Date.now() - t0, polls, timeline, final: { ...j, payload: undefined, outcome: undefined }, outcome, files };
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runQueue(process.argv[2], JSON.parse(process.argv[3]), { pollMs: Number(process.env.POLL_MS ?? 500), timeoutMs: Number(process.env.TIMEOUT_MS ?? 120000), label: process.env.LABEL ?? process.argv[2] });
  writeFileSync(`/home/user/.capy/work/probe/out/${result.label}-${Date.now()}.json`, JSON.stringify(result, null, 2));
  show(result);
}
