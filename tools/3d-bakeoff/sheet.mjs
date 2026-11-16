import { existsSync, readdirSync, statSync } from "node:fs";
import sharp from "sharp";
import { parseArgs, list, OUT, readJson, writeJson, ensureDir } from "./lib.mjs";

const BG = { r: 250, g: 250, b: 252 };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function label(text, width, height, { size = 22, weight = 600, align = "middle", color = "#222", bg = "#fafafc" } = {}) {
  const x = align === "start" ? 10 : width / 2;
  const lines = String(text).split("\n");
  const tspans = lines.map((line, i) => '<tspan x="' + x + '" dy="' + (i === 0 ? 0 : size * 1.2) + '">' + esc(line) + "</tspan>").join("");
  const y = height / 2 - ((lines.length - 1) * size * 1.2) / 2 + size * 0.35;
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><rect width="100%" height="100%" fill="' + bg + '"/><text x="' + x + '" y="' + y + '" font-family="DejaVu Sans, sans-serif" font-size="' + size + '" font-weight="' + weight + '" fill="' + color + '" text-anchor="' + align + '">' + tspans + "</text></svg>");
}

async function tile(path, size, missingText = "missing") {
  if (path && existsSync(path)) return sharp(path).resize(size, size, { fit: "contain", background: BG }).png().toBuffer();
  return sharp(label(missingText, size, size, { size: Math.round(size / 10), color: "#b00", bg: "#eee" })).png().toBuffer();
}

export async function grid({ rows, cols, cell, rowLabels, colLabels, cellPath, labelWidth = 260, headerHeight = 50, title, out }) {
  const titleH = title ? 70 : 0;
  const width = labelWidth + cols.length * cell;
  const height = titleH + headerHeight + rows.length * cell;
  const composites = [];
  if (title) composites.push({ input: await sharp(label(title, width, titleH, { size: 30, align: "start" })).png().toBuffer(), left: 0, top: 0 });
  for (let c = 0; c < cols.length; c++) {
    composites.push({ input: await sharp(label(colLabels[c], cell, headerHeight, { size: 20 })).png().toBuffer(), left: labelWidth + c * cell, top: titleH });
  }
  for (let r = 0; r < rows.length; r++) {
    composites.push({ input: await sharp(label(rowLabels[r], labelWidth, cell, { size: 20, align: "start" })).png().toBuffer(), left: 0, top: titleH + headerHeight + r * cell });
    for (let c = 0; c < cols.length; c++) {
      const { path, missing } = cellPath(rows[r], cols[c]);
      composites.push({ input: await tile(path, cell, missing), left: labelWidth + c * cell, top: titleH + headerHeight + r * cell });
    }
  }
  ensureDir(out.replace(/\/[^/]+$/, ""));
  await sharp({ create: { width, height, channels: 3, background: BG } }).composite(composites).jpeg({ quality: 86 }).toFile(out);
  return out;
}

async function lumaRaw(path, size = 320) {
  const { data, info } = await sharp(path).resize(size, size).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

export async function ssim(pathA, pathB) {
  const a = await lumaRaw(pathA);
  const b = await lumaRaw(pathB);
  const bg = a.data[0];
  let x0 = a.w, y0 = a.h, x1 = 0, y1 = 0;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const i = y * a.w + x;
    if (Math.abs(a.data[i] - bg) > 6 || Math.abs(b.data[i] - bg) > 6) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2, win = 8, stride = 4;
  let total = 0, n = 0;
  for (let y = y0; y + win <= y1 + 1; y += stride) for (let x = x0; x + win <= x1 + 1; x += stride) {
    let ma = 0, mb = 0;
    for (let j = 0; j < win; j++) for (let i = 0; i < win; i++) { const k = (y + j) * a.w + x + i; ma += a.data[k]; mb += b.data[k]; }
    ma /= win * win; mb /= win * win;
    let va = 0, vb = 0, cov = 0;
    for (let j = 0; j < win; j++) for (let i = 0; i < win; i++) { const k = (y + j) * a.w + x + i; const da = a.data[k] - ma, db = b.data[k] - mb; va += da * da; vb += db * db; cov += da * db; }
    va /= win * win - 1; vb /= win * win - 1; cov /= win * win - 1;
    total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
    n++;
  }
  return n ? total / n : null;
}

if (import.meta.url === "file://" + process.argv[1]) {
  const [mode] = process.argv.slice(2);
  const args = parseArgs(process.argv.slice(3));
  const tag = args.tag ?? "matrix";
  const base = OUT + tag + "/";
  const outDir = args.out ?? OUT + "sheets/";
  const days = list(args.days).length ? list(args.days) : Object.keys(readJson(new URL("./days.json", import.meta.url).pathname));
  const candidates = list(args.candidates).length ? list(args.candidates) : readdirSync(base).filter((d) => statSync(base + d).isDirectory()).sort();
  const names = args.names ? readJson(args.names) : {};
  const concept = (day) => OUT + (args.concepts ?? "concept") + "/" + day + ".png";
  const record = (cand, day) => readJson(base + cand + "/" + day + ".json", null);
  const missingText = (cand, day) => { const r = record(cand, day); return r ? (r.ok ? "no render" : "FAILED") : "not run"; };
  const cell = Number(args.cell ?? 240);
  if (mode === "hero") {
    await grid({
      rows: ["concept", ...candidates], cols: days, cell,
      rowLabels: ["concept image", ...candidates.map((c) => names[c] ?? c)], colLabels: days,
      cellPath: (row, day) => row === "concept" ? { path: concept(day) } : { path: base + row + "/" + day + ".v0.png", missing: missingText(row, day) },
      title: args.title ?? "Front 3/4 view, every candidate x every day", out: outDir + "contact-sheet.jpg",
    });
  }
  if (mode === "days") {
    for (const day of days) {
      await grid({
        rows: candidates, cols: ["concept", "v0", "v1", "v2", "v3"], cell,
        rowLabels: candidates.map((c) => names[c] ?? c), colLabels: ["concept", "front", "right", "back", "left"],
        cellPath: (cand, col) => col === "concept" ? { path: concept(day) } : { path: base + cand + "/" + day + "." + col + ".png", missing: missingText(cand, day) },
        title: day + ": every candidate, four orbit views", out: outDir + "day-" + day + ".jpg",
      });
    }
  }
  if (mode === "candidates") {
    for (const cand of candidates) {
      await grid({
        rows: days, cols: ["concept", "v0", "v1", "v2", "v3"], cell,
        rowLabels: days, colLabels: ["concept", "front", "right", "back", "left"],
        cellPath: (day, col) => col === "concept" ? { path: concept(day) } : { path: base + cand + "/" + day + "." + col + ".png", missing: missingText(cand, day) },
        title: (names[cand] ?? cand) + ": all days, four orbit views", out: outDir + "cand-" + cand + ".jpg",
      });
    }
  }
  if (mode === "mobile") {
    const mbase = OUT + (args.mtag ?? tag + "-mobile") + "/";
    const cand = candidates[0];
    const variants = ["orig", ...list(args.presets)];
    const pathOf = (v, day, view) => v === "orig" ? base + cand + "/" + day + "." + view + ".png" : mbase + cand + "@" + v + "/" + day + "." + view + ".png";
    const scores = {};
    for (const v of variants.slice(1)) for (const day of days) {
      const vals = [];
      for (const view of ["v0", "v1", "v2", "v3"]) if (existsSync(pathOf(v, day, view)) && existsSync(pathOf("orig", day, view))) vals.push(await ssim(pathOf("orig", day, view), pathOf(v, day, view)));
      scores[v + "/" + day] = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
    }
    writeJson(mbase + cand + ".ssim.json", scores);
    await grid({
      rows: variants, cols: days, cell,
      rowLabels: variants, colLabels: days,
      cellPath: (v, day) => ({ path: pathOf(v, day, args.view ?? "v0") }),
      title: (names[cand] ?? cand) + ": original vs phone-ready variants", out: outDir + "mobile-" + cand + ".jpg",
    });
    console.log(JSON.stringify(scores));
  }
}
