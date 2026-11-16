#!/usr/bin/env node
// Downloads everything the worldmodels page needs into spike/walkable/worldmodels/assets/ and installs
// the two small dependency folders the server uses (kit + this folder). Run from the repo root:
//   node spike/walkable/worldmodels/fetch-assets.mjs
// Live sessions stream from fal at run time, so the downloads are just the shared eye-level images
// (the world's starting frame and the page's poster) and recorded sessions for replay mode.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const walkable = path.resolve(here, "..");
const assetsDir = path.join(here, "assets");

for (const dir of [path.join(walkable, "kit"), here]) {
  if (!fs.existsSync(path.join(dir, "node_modules"))) {
    console.log("npm ci in " + path.relative(process.cwd(), dir));
    execSync("npm ci --no-audit --no-fund", { cwd: dir, stdio: "inherit" });
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(here, "manifest.json"), "utf8"));
const inputs = JSON.parse(fs.readFileSync(path.join(walkable, "inputs.json"), "utf8"));
const wanted = [...(manifest.assets || [])];
for (const [day, entry] of Object.entries(inputs.days || {})) {
  const key = Object.keys(entry || {}).find((k) => /eye/i.test(k));
  const url = key && (typeof entry[key] === "string" ? entry[key] : entry[key]?.url);
  if (url && !wanted.some((a) => a.day === day && a.role === "eye_level")) {
    const ext = path.extname(new URL(url).pathname) || ".png";
    wanted.push({ day, role: "eye_level", url, file: day + "-eye_level" + ext });
  }
}

fs.mkdirSync(assetsDir, { recursive: true });
const index = {};
let total = 0;
for (const a of wanted) {
  const dest = path.join(assetsDir, a.file);
  if (!dest.startsWith(assetsDir + path.sep)) throw new Error("bad file name " + a.file);
  if (!fs.existsSync(dest) || (a.bytes && fs.statSync(dest).size !== a.bytes)) {
    const t0 = Date.now();
    const res = await fetch(a.url);
    if (!res.ok) {
      console.warn("skip " + a.file + ": HTTP " + res.status);
      continue;
    }
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log("got " + a.file + " (" + (fs.statSync(dest).size / 1e6).toFixed(2) + " MB in " + ((Date.now() - t0) / 1000).toFixed(1) + " s)");
  }
  total += fs.statSync(dest).size;
  const day = (index[a.day] ||= {});
  day[a.role] = "/assets/" + a.file;
  if (a.model) day[a.role + "_model"] = a.model;
}
fs.writeFileSync(path.join(assetsDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(Object.keys(index).length + " days, " + (total / 1e6).toFixed(2) + " MB in " + path.relative(process.cwd(), assetsDir));

// Branching-walk clips (clips.json, made by make-clips.mjs on GMI): download each finished clip, re-encode it for
// phones (H.264 main, no audio, faststart; clips only play from the start, so no short GOP), make a reversed copy for "back", and write
// assets/walk/<day>.json for walk.html. Needs ffmpeg and ffprobe on PATH.
const clipsPath = path.join(here, "clips.json");
if (fs.existsSync(clipsPath)) {
  const clips = JSON.parse(fs.readFileSync(clipsPath, "utf8"));
  const walkDir = path.join(assetsDir, "walk");
  const ff = (args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);
  const enc = ["-an", "-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "23", "-movflags", "+faststart"];
  for (const [day, dv] of Object.entries(clips.days || {})) {
    const dayDir = path.join(walkDir, day);
    fs.mkdirSync(dayDir, { recursive: true });
    const eye = index[day]?.eye_level ? path.join(assetsDir, path.basename(index[day].eye_level)) : null;
    const start = path.join(dayDir, "start.jpg");
    if (eye && !fs.existsSync(start)) ff(["-i", eye, "-vf", "scale=1280:-2", "-q:v", "3", start]);
    const out = { day, start: "/assets/walk/" + day + "/start.jpg", sets: {} };
    for (const [set, sv] of Object.entries(dv.sets || {})) {
      const edges = [];
      for (const [id, e] of Object.entries(sv.edges || {})) {
        if (e.status !== "ok" || !e.url) continue;
        const dir = path.join(dayDir, set);
        fs.mkdirSync(dir, { recursive: true });
        const src = path.join(dir, id + ".src.mp4");
        const fwd = path.join(dir, id + ".mp4");
        const rev = path.join(dir, id + ".rev.mp4");
        if (!fs.existsSync(src)) {
          const res = await fetch(e.url);
          if (!res.ok) {
            console.warn("skip clip " + day + "/" + set + "/" + id + ": HTTP " + res.status);
            continue;
          }
          fs.writeFileSync(src, Buffer.from(await res.arrayBuffer()));
        }
        if (!fs.existsSync(fwd)) ff(["-i", src, "-vf", "scale='min(1280,iw)':-2", ...enc, fwd]);
        if (!fs.existsSync(rev)) ff(["-i", fwd, "-vf", "reverse", ...enc, rev]);
        const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", fwd]).toString());
        const [num, den] = probe.streams[0].r_frame_rate.split("/").map(Number);
        const rel = (f) => "/assets/walk/" + day + "/" + set + "/" + path.basename(f);
        edges.push({
          id, from: e.from || "start", move: e.move, src: rel(fwd), rev: rel(rev),
          w: probe.streams[0].width, h: probe.streams[0].height, fps: Math.round((num / den) * 10) / 10, dur: +Number(probe.format.duration).toFixed(2),
          bytes: fs.statSync(fwd).size, rev_bytes: fs.statSync(rev).size,
          gen: { model: e.model, request_id: e.request_id, latency_s: e.latency_s, server_s: e.server_s, cost_usd: e.est_cost_usd, source_bytes: fs.statSync(src).size },
        });
      }
      if (edges.length) out.sets[set] = { model: sv.model, price: sv.price, edges };
    }
    fs.writeFileSync(path.join(walkDir, day + ".json"), JSON.stringify(out, null, 2) + "\n");
    console.log("walk " + day + ": " + Object.entries(out.sets).map(([k, v]) => k + " " + v.edges.length + " clips").join(", "));
  }
}
