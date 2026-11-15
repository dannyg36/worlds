#!/usr/bin/env node
// Contact sheet from labelled images.
// node sheet.mjs <out.png> <title> "<row label>" <img>:<caption> <img>:<caption> -- "<row label>" ...
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const [out, title, ...rest] = process.argv.slice(2);
const rows = [];
let cur = null;
for (const a of rest) {
  if (a === "--") { cur = null; continue; }
  if (!cur) { cur = { label: a, cells: [] }; rows.push(cur); continue; }
  const i = a.lastIndexOf(":");
  cur.cells.push({ src: path.resolve(a.slice(0, i)), cap: a.slice(i + 1) });
}
const uri = (p) => `data:image/${path.extname(p).slice(1).replace("jpg", "jpeg")};base64,${fs.readFileSync(p).toString("base64")}`;
const cols = Math.max(...rows.map((r) => r.cells.length));
const html = `<html><body style="margin:0;padding:28px;background:#f3f1ec;font:15px -apple-system,Helvetica;color:#222">
<h1 style="font-size:26px;margin:0 0 18px">${title}</h1>
${rows.map((r) => `<div style="margin:0 0 6px;font-weight:600">${r.label}</div>
<div style="display:grid;grid-template-columns:repeat(${cols},420px);gap:10px;margin-bottom:22px">
${r.cells.map((c) => `<figure style="margin:0"><img src="${uri(c.src)}" style="width:420px;height:420px;object-fit:cover;border-radius:6px;display:block"><figcaption style="font-size:13px;margin-top:4px;color:#555">${c.cap}</figcaption></figure>`).join("")}
</div>`).join("")}</body></html>`;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const page = await browser.newPage({ viewport: { width: 56 + cols * 430, height: 400 } });
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
