#!/usr/bin/env node
// Downloads everything the worldmodels page needs into spike/walkable/worldmodels/assets/ and installs
// the two small dependency folders the server uses (kit + this folder). Run from the repo root:
//   node spike/walkable/worldmodels/fetch-assets.mjs
// Live sessions stream from fal at run time, so the downloads are just the shared eye-level images
// (the world's starting frame and the page's poster) and recorded sessions for replay mode.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
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
