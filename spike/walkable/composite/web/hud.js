export class Perf {
  constructor(size = 900) {
    this.size = size;
    this.dts = new Float32Array(size);
    this.ts = new Float64Array(size);
    this.i = 0;
    this.n = 0;
    this.total = 0;
    this.long = 0;
    this.last = null;
  }
  tick(now) {
    if (this.last != null) {
      const dt = now - this.last;
      this.dts[this.i] = dt;
      this.ts[this.i] = now;
      this.i = (this.i + 1) % this.size;
      this.n = Math.min(this.size, this.n + 1);
      this.total++;
      if (dt > 50) this.long++;
    }
    this.last = now;
  }
  window(ms) {
    const arr = [];
    for (let k = 0; k < this.n; k++) {
      const idx = (this.i - 1 - k + this.size) % this.size;
      if (this.last - this.ts[idx] > ms) break;
      arr.push(this.dts[idx]);
    }
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = arr.reduce((s, v) => s + v, 0);
    const q = (f) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))];
    return { frames: arr.length, fps: +((1000 * arr.length) / sum).toFixed(1), avg_ms: +(sum / arr.length).toFixed(2), p50_ms: +q(0.5).toFixed(2), p95_ms: +q(0.95).toFixed(2), max_ms: +sorted[sorted.length - 1].toFixed(1) };
  }
}

export function glInfo(renderer) {
  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const exts = gl.getSupportedExtensions() || [];
  return {
    webgl2: typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext,
    version: gl.getParameter(gl.VERSION),
    glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    max_texture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    max_samples: renderer.capabilities.maxSamples,
    compressed: {
      astc: exts.includes("WEBGL_compressed_texture_astc"),
      etc: exts.includes("WEBGL_compressed_texture_etc"),
      s3tc: exts.includes("WEBGL_compressed_texture_s3tc"),
      bptc: exts.includes("EXT_texture_compression_bptc"),
      pvrtc: exts.includes("WEBGL_compressed_texture_pvrtc") || exts.includes("WEBKIT_WEBGL_compressed_texture_pvrtc"),
    },
    extensions: exts.length,
  };
}

export function gpuEstimate(scene) {
  const textures = new Set();
  const geos = new Set();
  scene.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) for (const v of Object.values(m)) if (v && v.isTexture) textures.add(v);
  });
  if (scene.background?.isTexture) textures.add(scene.background);
  let texBytes = 0;
  let biggest = 0;
  for (const t of textures) {
    if (t.isCompressedTexture) {
      texBytes += (t.mipmaps || []).reduce((s, m) => s + (m.data?.byteLength || 0), 0);
      biggest = Math.max(biggest, t.mipmaps?.[0]?.width || 0);
      continue;
    }
    const w = t.image?.width || 0, h = t.image?.height || 0;
    texBytes += w * h * 4 * (t.generateMipmaps === false ? 1 : 1.33);
    biggest = Math.max(biggest, w, h);
  }
  let geoBytes = 0;
  let vertices = 0;
  for (const g of geos) {
    for (const a of Object.values(g.attributes)) geoBytes += a.array.byteLength;
    if (g.index) geoBytes += g.index.array.byteLength;
    vertices += g.attributes.position?.count || 0;
  }
  return { textures: textures.size, tex_mb: +(texBytes / 1048576).toFixed(1), biggest_texture: biggest, geometries: geos.size, geo_mb: +(geoBytes / 1048576).toFixed(1), vertices };
}

export async function recordCanvas(canvas, seconds, name, onStatus) {
  if (!canvas.captureStream || typeof MediaRecorder === "undefined") throw new Error("captureStream or MediaRecorder unavailable");
  const stream = canvas.captureStream(30);
  const types = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
  const rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8000000 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start(1000);
  for (let s = seconds; s > 0; s--) {
    onStatus("REC " + s + "s");
    await new Promise((r) => setTimeout(r, 1000));
  }
  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  const blob = new Blob(chunks, { type: rec.mimeType || mimeType || "video/webm" });
  onStatus("upload " + (blob.size / 1048576).toFixed(1) + " MB");
  const res = await fetch("clip?name=" + encodeURIComponent(name), { method: "POST", body: blob, headers: { "Content-Type": blob.type } });
  return res.json();
}
