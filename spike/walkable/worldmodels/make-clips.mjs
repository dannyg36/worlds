#!/usr/bin/env node
// GMI fallback for approach "worldmodels": a branching walk made of image-to-video camera moves.
// Each clip starts from a node image (the day's shared eye-level image, or the last frame of an earlier clip)
// and moves the camera one way: walk forward, turn left or turn right. The phone page (walk.html) chains them.
//
//   node spike/walkable/worldmodels/make-clips.mjs --day hackathon,santa-cruz --sets veo,hailuo [--moves forward,left,right]
//   node spike/walkable/worldmodels/make-clips.mjs --day hackathon --sets veo --from forward      (hop 2: from the end of that set's forward clip)
//   node spike/walkable/worldmodels/make-clips.mjs --plan ...                                     (print the jobs and cost, submit nothing)
//
// Every call goes through kit/gmi.mjs (budget check, polling, ledger). One invocation runs at most 12 jobs and is
// refused up front when their estimated cost would pass the worldmodels cap. Results land in clips.json (committed:
// prompts, payloads, request ids, latency, cost and the GMI video URLs); fetch-assets.mjs turns them into phone files.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { run, upload } from "../kit/gmi.mjs";
import { budgets, parseArgs, spent } from "../kit/ledger.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const walkable = path.resolve(here, "..");
const APPROACH = "worldmodels";
const MAX_JOBS = 12;
const manifestPath = path.join(here, "clips.json");
const inputs = JSON.parse(fs.readFileSync(path.join(walkable, "inputs.json"), "utf8"));

const STEADY = "One smooth continuous camera move, steady and level like a gimbal, at a slow walking pace. The scene, people and objects stay consistent. No cuts.";
const NEGATIVE = "cuts, scene change, fast motion, shaky camera, zoom, morphing, warping, distorted faces, extra limbs, text, watermark, blurry";
const PROMPTS = {
  hackathon: {
    forward: "First-person view at eye level, walking slowly forward into the office toward the long table and the cheering team, stepping between the open pizza boxes on the floor.",
    left: "First-person view at eye level, standing still and slowly turning to the left (the camera pans left about 90 degrees), revealing more of the office to the left: desks, office chairs and the sunset windows.",
    right: "First-person view at eye level, standing still and slowly turning to the right (the camera pans right about 90 degrees), revealing more of the office to the right: bookshelves, a plant and more desks with laptops.",
  },
  "santa-cruz": {
    forward: "First-person view at eye level, walking slowly forward along the cliffside path past the two parked rental bikes toward the wooden railing, the ocean and the surfers ahead, waves rolling in.",
    left: "First-person view at eye level, standing on the cliff path and slowly turning to the left (the camera pans left about 90 degrees) toward the long wooden wharf with sea lions on the pilings.",
    right: "First-person view at eye level, standing on the cliff path and slowly turning to the right (the camera pans right about 90 degrees) along the cliffs and the railing, surfers riding the waves below.",
  },
};
const HAILUO_CAMERA = { forward: "[Push in]", left: "[Pan left]", right: "[Pan right]" };
const STYLE = "Stylized 3D animated-film look, soft clay-like materials, warm cinematic light.";

// Prices from the GMI model cards (catalog/gmi-models/*.json), for exactly the parameters sent below.
const SETS = {
  veo: {
    model: "veo-3.1-lite-generate-001", seconds: 4, est: 0.12, price: "$0.03/s at 720p without audio",
    payload: (image, prompt) => ({ prompt, image, durationSeconds: 4, aspectRatio: "16:9", resolution: "720p", generateAudio: false, personGeneration: "allow_adult" }),
  },
  hailuo: {
    model: "Minimax-Hailuo-2.3-Fast", seconds: 6, est: 0.192, price: "$0.032/s, 6 s minimum, 768P",
    payload: (image, prompt, move) => ({ prompt: prompt + " " + HAILUO_CAMERA[move], first_frame_image: image, duration: 6, resolution: "768P", prompt_optimizer: false }),
  },
  wan: {
    model: "wan3.0-video", seconds: 4, est: 0.2, price: "$0.05/s at 480P",
    payload: (image, prompt) => ({ prompt, negative_prompt: NEGATIVE, first_frame: image, resolution: "480P", ratio: "16:9", duration: 4, prompt_extend: false, watermark: false }),
  },
  ltx2: {
    model: "LTX-2", seconds: 4, est: 0.01, price: "$0.01 per request",
    payload: (image, prompt) => ({ prompt, negative_prompt: NEGATIVE, image_path: image, width: 1280, height: 704, num_frames: 97, fps: 24 }),
  },
  kling: {
    model: "kling-v2-5-turbo", seconds: 5, est: 0.35, price: "$0.07/s, 5 s",
    payload: (image, prompt) => ({ prompt, negative_prompt: NEGATIVE, image, duration: "5", mode: "pro", cfg_scale: 0.5 }),
  },
};

const readManifest = () => (fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { days: {} });
function saveEdge(day, set, edgeId, record) {
  const m = readManifest();
  m.note = "Branching-walk clips from GMI image-to-video models. Edge ids are node paths: 'forward' starts at the day's eye image ('start'); 'forward.left' starts at the last frame of 'forward'. fetch-assets.mjs downloads each url and builds the phone files.";
  const s = (m.days[day] ||= { sets: {} }).sets[set] ||= { model: SETS[set].model, price: SETS[set].price, edges: {} };
  s.edges[edgeId] = record;
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n");
}

const videoUrl = (files) => (files.find((f) => /\.mp4(\?|$)/i.test(f.url)) || files.find((f) => /video|media_urls/i.test(f.key) && !/thumb/i.test(f.key)))?.url ?? null;

async function nodeImage(day, set, from) {
  if (from === "start") return inputs.days[day]?.eye?.url;
  const prior = readManifest().days[day]?.sets?.[set]?.edges?.[from];
  if (!prior?.url) throw new Error(day + "/" + set + ": no finished clip '" + from + "' to start from");
  if (prior.end_frame_url) return prior.end_frame_url;
  const dir = path.join(here, "assets", "clips", day, set);
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, from + ".src.mp4");
  if (!fs.existsSync(src)) fs.writeFileSync(src, Buffer.from(await (await fetch(prior.url)).arrayBuffer()));
  const png = path.join(dir, from + ".last.png");
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-sseof", "-0.25", "-i", src, "-update", "1", "-frames:v", "1", png]);
  const url = await upload(png);
  saveEdge(day, set, from, { ...prior, end_frame_url: url });
  return url;
}

const args = parseArgs(process.argv.slice(2));
const days = String(args.day || "hackathon").split(",");
const sets = String(args.sets || "veo").split(",");
const moves = String(args.moves || "forward,left,right").split(",");
const from = String(args.from || "start");
const timeoutS = Number(args["timeout-s"] || 900);

const jobs = [];
for (const day of days) {
  if (!PROMPTS[day]) throw new Error("unknown day " + day);
  for (const set of sets) {
    if (!SETS[set]) throw new Error("unknown set " + set + "; known: " + Object.keys(SETS).join(", "));
    for (const move of moves) {
      if (!PROMPTS[day][move]) throw new Error("unknown move " + move);
      const edgeId = from === "start" ? move : from + "." + move;
      const prompt = PROMPTS[day][move] + " " + STEADY + " " + STYLE;
      jobs.push({ day, set, move, edgeId, prompt, est: SETS[set].est });
    }
  }
}
const total = jobs.reduce((s, j) => s + j.est, 0);
const before = spent(APPROACH);
const cap = budgets[APPROACH].cap_usd;
console.log(jobs.length + " jobs, est $" + total.toFixed(3) + "; worldmodels has spent ~$" + before.toFixed(3) + " of $" + cap);
for (const j of jobs) console.log("  " + j.day + " " + j.set + " " + j.edgeId + " ($" + j.est + ")");
if (jobs.length > MAX_JOBS) throw new Error("refusing " + jobs.length + " jobs in one run; the limit is " + MAX_JOBS);
if (before + total > cap) throw new Error("refusing: this batch would pass the $" + cap + " cap");
if (args.plan) process.exit(0);

const results = await Promise.allSettled(jobs.map(async (j) => {
  const image = await nodeImage(j.day, j.set, from);
  const payload = SETS[j.set].payload(image, j.prompt, j.move);
  const label = j.day + "-" + j.set + "-" + j.edgeId;
  const base = { from, move: j.move, model: SETS[j.set].model, image, prompt: j.prompt, payload };
  try {
    const { entry, files } = await run({ approach: APPROACH, model: SETS[j.set].model, payload, estCostUsd: j.est, label, timeoutS });
    const rec = { ...base, status: "ok", url: videoUrl(files), files: files.map((f) => ({ key: f.key, url: f.url })), request_id: entry.request_id, ts: entry.ts, latency_s: entry.latency_s, queue_wait_s: entry.queue_wait_s, server_s: entry.server_s, est_cost_usd: entry.est_cost_usd };
    saveEdge(j.day, j.set, j.edgeId, rec);
    return rec;
  } catch (e) {
    const rec = { ...base, status: "error", error: String(e?.message ?? e).slice(0, 600), ts: new Date().toISOString() };
    saveEdge(j.day, j.set, j.edgeId, rec);
    throw e;
  }
}));
results.forEach((r, i) => {
  const j = jobs[i];
  if (r.status === "fulfilled") console.log("ok    " + j.day + " " + j.set + " " + j.edgeId + "  " + r.value.latency_s + " s wall, " + r.value.server_s + " s on GMI  " + r.value.url);
  else console.log("error " + j.day + " " + j.set + " " + j.edgeId + "  " + String(r.reason?.message ?? r.reason).slice(0, 300));
});
console.log("worldmodels spend now ~$" + spent(APPROACH).toFixed(3) + " of $" + cap);
