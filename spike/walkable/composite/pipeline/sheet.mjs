#!/usr/bin/env node
// Crop a sprite sheet (objects in a cols x rows grid on white) into one square image per object, plus an RGBA cutout.
// Components of non-white pixels are assigned to the grid cell that holds their center, so an object that strays
// over a cell border still comes out whole; an empty cell falls back to the cell rectangle.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const WHITE = 236;

export async function loadRaw(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}

export function components(img, step = 4, dilate = 3) {
  const { data, w, h, ch } = img;
  const gw = Math.ceil(w / step), gh = Math.ceil(h / step);
  const fg = new Uint8Array(gw * gh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      if (data[i] < WHITE || data[i + 1] < WHITE || data[i + 2] < WHITE) fg[Math.floor(y / step) * gw + Math.floor(x / step)] = 1;
    }
  }
  const grown = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!fg[y * gw + x]) continue;
      for (let dy = -dilate; dy <= dilate; dy++) for (let dx = -dilate; dx <= dilate; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) grown[yy * gw + xx] = 1;
      }
    }
  }
  const label = new Int32Array(gw * gh).fill(-1);
  const comps = [];
  for (let s = 0; s < gw * gh; s++) {
    if (!grown[s] || label[s] >= 0) continue;
    const id = comps.length;
    const c = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, cells: 0, fg: 0 };
    const stack = [s];
    label[s] = id;
    while (stack.length) {
      const p = stack.pop();
      const x = p % gw, y = (p - x) / gw;
      c.cells++;
      if (fg[p]) {
        c.fg++;
        c.x0 = Math.min(c.x0, x); c.y0 = Math.min(c.y0, y); c.x1 = Math.max(c.x1, x); c.y1 = Math.max(c.y1, y);
      }
      for (const q of [p - 1, p + 1, p - gw, p + gw]) {
        if (q < 0 || q >= gw * gh || label[q] >= 0 || !grown[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === gw - 1)) continue;
        label[q] = id;
        stack.push(q);
      }
    }
    if (c.fg) comps.push({ x0: c.x0 * step, y0: c.y0 * step, x1: Math.min(w, (c.x1 + 1) * step), y1: Math.min(h, (c.y1 + 1) * step), area: c.fg * step * step });
  }
  return comps;
}

export async function cropSheet(file, { ids, cols, rows, outDir, size = 1024, pad = 0.1 }) {
  const img = await loadRaw(file);
  const { w, h } = img;
  const comps = components(img).filter((c) => c.area > w * h * 0.0015);
  const cw = w / cols, chh = h / rows;
  fs.mkdirSync(outDir, { recursive: true });
  const out = [];
  for (const [k, id] of ids.entries()) {
    const col = k % cols, row = Math.floor(k / cols);
    const mine = comps.filter((c) => Math.floor((c.x0 + c.x1) / 2 / cw) === col && Math.floor((c.y0 + c.y1) / 2 / chh) === row);
    let box = mine.length
      ? mine.reduce((b, c) => ({ x0: Math.min(b.x0, c.x0), y0: Math.min(b.y0, c.y0), x1: Math.max(b.x1, c.x1), y1: Math.max(b.y1, c.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
      : { x0: col * cw + cw * 0.04, y0: row * chh + chh * 0.04, x1: (col + 1) * cw - cw * 0.04, y1: (row + 1) * chh - chh * 0.04 };
    const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    const side = Math.ceil(Math.max(bw, bh) * (1 + 2 * pad));
    const left = Math.round(box.x0 + bw / 2 - side / 2), top = Math.round(box.y0 + bh / 2 - side / 2);
    const ex = { left: Math.max(0, -left), top: Math.max(0, -top), right: Math.max(0, left + side - w), bottom: Math.max(0, top + side - h) };
    const region = { left: Math.max(0, left), top: Math.max(0, top), width: Math.min(w, left + side) - Math.max(0, left), height: Math.min(h, top + side) - Math.max(0, top) };
    const square = await sharp(file).removeAlpha().extract(region).extend({ ...ex, background: { r: 255, g: 255, b: 255 } }).resize(size, size).png().toBuffer();
    const imgPath = path.join(outDir, id + ".png");
    fs.writeFileSync(imgPath, square);
    const cutPath = path.join(outDir, id + ".cutout.png");
    await cutout(square, cutPath);
    out.push({ id, image: imgPath, cutout: cutPath, box: { x: Math.round(box.x0), y: Math.round(box.y0), w: Math.round(bw), h: Math.round(bh) }, components: mine.length, fallback: !mine.length });
  }
  return { sheet: { w, h, cols, rows, components: comps.length }, crops: out };
}

export async function cutout(input, outPath) {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const white = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const r = data[p * 3], g = data[p * 3 + 1], b = data[p * 3 + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    white[p] = mn / 255 - (mx - mn) / 255;
  }
  const bg = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop();
    if (bg[p] || white[p] < 0.9) continue;
    bg[p] = 1;
    const x = p % w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (p >= w) stack.push(p - w);
    if (p < w * (h - 1)) stack.push(p + w);
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    let a = bg[p] ? 0 : 255;
    if (!bg[p]) {
      const x = p % w;
      const nearBg = (x > 0 && bg[p - 1]) || (x < w - 1 && bg[p + 1]) || (p >= w && bg[p - w]) || (p < w * (h - 1) && bg[p + w]);
      if (nearBg) a = Math.round(255 * Math.min(1, Math.max(0.25, (1 - white[p]) / 0.2)));
    }
    rgba[p * 4] = data[p * 3];
    rgba[p * 4 + 1] = data[p * 3 + 1];
    rgba[p * 4 + 2] = data[p * 3 + 2];
    rgba[p * 4 + 3] = a;
  }
  await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).trim({ threshold: 1 }).png().toFile(outPath);
  return outPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, idsCsv, grid, outDir] = process.argv.slice(2);
  const [cols, rows] = grid.split("x").map(Number);
  console.log(JSON.stringify(await cropSheet(file, { ids: idsCsv.split(","), cols, rows, outDir }), null, 2));
}
