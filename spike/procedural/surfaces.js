// Floor textures for bases, island ground and vignette plots. One texture repeat covers about 1.9 m at the default repeat.
// kind: cobblestone | grass | wood | tile | sand | snow | asphalt | carpet | water; r: a seeded random function.
import { canvasTex } from "./core.js";

export function surfaceTex(kind, r) {
  const draw = {
    cobblestone(ctx, w) {
      ctx.fillStyle = "#6f675e"; ctx.fillRect(0, 0, w, w);
      const n = 10, s = w / n;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const off = (y % 2) * s * 0.5;
        const l = 52 + r() * 22, hue = 25 + r() * 15;
        ctx.fillStyle = `hsl(${hue},${10 + r() * 12}%,${l}%)`;
        const jx = r() * 2, jy = r() * 2;
        // Draw twice across the right edge so the texture wraps without a seam.
        for (const wrap of [0, -w]) {
          ctx.beginPath();
          ctx.roundRect(x * s + off + 2 + jx + wrap, y * s + 2 + jy, s - 5, s - 5, s * 0.3);
          ctx.fill();
        }
      }
    },
    grass(ctx, w) {
      ctx.fillStyle = "#5f9a45"; ctx.fillRect(0, 0, w, w);
      for (let i = 0; i < 5000; i++) {
        ctx.fillStyle = `hsl(${90 + r() * 30},${40 + r() * 20}%,${30 + r() * 25}%)`;
        ctx.fillRect(r() * w, r() * w, 1.5, 3 + r() * 3);
      }
    },
    wood(ctx, w) {
      const n = 8, s = w / n;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = `hsl(28,${35 + r() * 15}%,${36 + r() * 12}%)`;
        ctx.fillRect(0, i * s, w, s - 2);
        ctx.strokeStyle = "rgba(60,30,10,0.18)";
        for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.moveTo(0, i * s + r() * s); ctx.bezierCurveTo(w * 0.3, i * s + r() * s, w * 0.6, i * s + r() * s, w, i * s + r() * s); ctx.stroke(); }
        ctx.fillStyle = "rgba(40,20,5,0.5)"; ctx.fillRect(r() * w, i * s, 2, s - 2);
      }
    },
    tile(ctx, w) {
      const n = 8, s = w / n;
      ctx.fillStyle = "#e9e0cf"; ctx.fillRect(0, 0, w, w);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        ctx.fillStyle = `hsl(18,${45 + r() * 15}%,${50 + r() * 10}%)`;
        ctx.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
      }
    },
    sand(ctx, w) {
      ctx.fillStyle = "#e6cf9c"; ctx.fillRect(0, 0, w, w);
      for (let i = 0; i < 6000; i++) { ctx.fillStyle = `hsla(40,40%,${55 + r() * 30}%,0.6)`; ctx.fillRect(r() * w, r() * w, 2, 2); }
    },
    snow(ctx, w) {
      ctx.fillStyle = "#eef3fb"; ctx.fillRect(0, 0, w, w);
      for (let i = 0; i < 3000; i++) { ctx.fillStyle = `hsla(220,40%,${85 + r() * 15}%,0.7)`; ctx.fillRect(r() * w, r() * w, 3, 3); }
    },
    asphalt(ctx, w) {
      ctx.fillStyle = "#4a4d52"; ctx.fillRect(0, 0, w, w);
      for (let i = 0; i < 6000; i++) { ctx.fillStyle = `hsla(220,5%,${25 + r() * 30}%,0.7)`; ctx.fillRect(r() * w, r() * w, 2, 2); }
    },
    carpet(ctx, w) {
      ctx.fillStyle = "#7a3b3b"; ctx.fillRect(0, 0, w, w);
      for (let i = 0; i < 6000; i++) { ctx.fillStyle = `hsla(0,40%,${20 + r() * 20}%,0.5)`; ctx.fillRect(r() * w, r() * w, 2, 2); }
    },
    water(ctx, w) {
      const g = ctx.createLinearGradient(0, 0, w, w); g.addColorStop(0, "#2f8fb8"); g.addColorStop(1, "#1b5f8a");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      for (let i = 0; i < 80; i++) { const x = r() * w, y = r() * w; ctx.beginPath(); ctx.arc(x, y, 6 + r() * 10, 0.2, 1.4); ctx.stroke(); }
    },
  }[kind] ?? null;
  const rep = { cobblestone: 5, tile: 4, wood: 3, grass: 3, carpet: 2 }[kind] ?? 3;
  return draw ? canvasTex(512, 512, draw, { repeat: [rep, rep] }) : null;
}
