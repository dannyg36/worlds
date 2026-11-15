import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const allowRoot = path.resolve(here, '..');
const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const size = Number(process.argv[3] || 768);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = u.startsWith('/abs/') ? u.slice(4) : path.join(here, u);
  file = path.resolve(file);
  if (!file.startsWith(allowRoot) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: size, height: size } });
page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });
await page.goto('http://127.0.0.1:' + port + '/viewer.html');
await page.waitForFunction(() => window.__ready === true);

for (const job of jobs) {
  const t0 = Date.now();
  try {
    const stats = await page.evaluate(([u, s]) => window.loadGLB(u, s), ['/abs' + path.resolve(job.glb), size]);
    fs.mkdirSync(path.dirname(job.out), { recursive: true });
    const outputs = [];
    for (const v of job.views || []) {
      const data = await page.evaluate(([a, e, m, mg]) => window.renderView(a, e, m, mg), [v.az, v.el, v.mode || 'tex', v.margin || 1.08]);
      const f = job.out + '_' + (v.name || (v.mode || 'tex') + '_az' + v.az + '_el' + v.el) + '.png';
      fs.writeFileSync(f, Buffer.from(data.split(',')[1], 'base64'));
      outputs.push(f);
    }
    if (job.turntable) {
      const dir = job.out + '_turntable';
      fs.mkdirSync(dir, { recursive: true });
      const n = job.turntable;
      for (let i = 0; i < n; i++) {
        const az = (job.turntableStart || 0) + (360 * i) / n;
        const data = await page.evaluate(([a, e]) => window.renderView(a, e, 'tex', 1.08), [az, job.turntableEl || 22]);
        fs.writeFileSync(path.join(dir, String(i).padStart(3, '0') + '.png'), Buffer.from(data.split(',')[1], 'base64'));
      }
      outputs.push(dir);
    }
    fs.writeFileSync(job.out + '_stats.json', JSON.stringify({ ...stats, ms: Date.now() - t0 }, null, 1));
    console.log('OK', job.glb, JSON.stringify(stats), (Date.now() - t0) + 'ms');
  } catch (e) {
    console.error('FAIL', job.glb, e.message);
  }
}
await browser.close();
server.close();
