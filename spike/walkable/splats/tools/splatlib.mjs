// Small splat toolkit for the spike: SPZ v2 writer, PLY reader, 3DGS PLY decoding, equirect helpers.
import zlib from "node:zlib";

export const SH_C0 = 0.28209479177387814;
const clampByte = (x) => (x < 0 ? 0 : x > 255 ? 255 : Math.round(x));

// Writes Niantic SPZ v2 (gzip; positions 24-bit fixed point, alpha/color/scale/rotation 8-bit, SH degree 0).
// positions: xyz, scales: linear sigmas, quats: xyzw, opacities: 0..1, colors: linear-ish display rgb 0..1.
export function encodeSpz({ n, positions, scales, quats, opacities, colors, fractionalBits = 12 }) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(0x5053474e, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(n, 8);
  header.writeUInt8(0, 12);
  header.writeUInt8(fractionalBits, 13);
  header.writeUInt8(0, 14);
  header.writeUInt8(0, 15);
  const fx = 1 << fractionalBits;
  const lo = -(1 << 23), hi = (1 << 23) - 1;
  const pos = Buffer.alloc(n * 9);
  for (let i = 0; i < n * 3; i++) {
    let v = Math.round(positions[i] * fx);
    v = v < lo ? lo : v > hi ? hi : v;
    pos[i * 3] = v & 0xff;
    pos[i * 3 + 1] = (v >> 8) & 0xff;
    pos[i * 3 + 2] = (v >> 16) & 0xff;
  }
  const alpha = Buffer.alloc(n);
  for (let i = 0; i < n; i++) alpha[i] = clampByte(opacities[i] * 255);
  const col = Buffer.alloc(n * 3);
  for (let i = 0; i < n * 3; i++) col[i] = clampByte(((colors[i] - 0.5) / SH_C0) * 0.15 * 255 + 127.5);
  const sc = Buffer.alloc(n * 3);
  for (let i = 0; i < n * 3; i++) sc[i] = clampByte((Math.log(Math.max(scales[i], 1e-7)) + 10) * 16);
  const rot = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    let x = quats[i * 4], y = quats[i * 4 + 1], z = quats[i * 4 + 2], w = quats[i * 4 + 3];
    const l = Math.hypot(x, y, z, w) || 1;
    const s = (w < 0 ? -1 : 1) / l;
    rot[i * 3] = clampByte(x * s * 127.5 + 127.5);
    rot[i * 3 + 1] = clampByte(y * s * 127.5 + 127.5);
    rot[i * 3 + 2] = clampByte(z * s * 127.5 + 127.5);
  }
  return zlib.gzipSync(Buffer.concat([header, pos, alpha, col, sc, rot]), { level: 9 });
}

const plyTypes = {
  char: ["getInt8", 1], int8: ["getInt8", 1], uchar: ["getUint8", 1], uint8: ["getUint8", 1],
  short: ["getInt16", 2], int16: ["getInt16", 2], ushort: ["getUint16", 2], uint16: ["getUint16", 2],
  int: ["getInt32", 4], int32: ["getInt32", 4], uint: ["getUint32", 4], uint32: ["getUint32", 4],
  float: ["getFloat32", 4], float32: ["getFloat32", 4], double: ["getFloat64", 8], float64: ["getFloat64", 8],
};

// Reads the first element (vertex) of a binary_little_endian or ascii PLY into Float32Arrays keyed by property name.
export function readPly(buf) {
  const marker = buf.indexOf("end_header");
  if (marker < 0) throw new Error("not a PLY file");
  const headerEnd = buf.indexOf(10, marker) + 1;
  const lines = buf.subarray(0, headerEnd).toString("latin1").split(/\r?\n/);
  let format = null;
  const elements = [];
  for (const line of lines) {
    const t = line.trim().split(/\s+/);
    if (t[0] === "format") format = t[1];
    else if (t[0] === "element") elements.push({ name: t[1], count: Number(t[2]), props: [] });
    else if (t[0] === "property") {
      if (t[1] === "list") elements[elements.length - 1].props.push({ list: true, countType: t[2], type: t[3], name: t[4] });
      else elements[elements.length - 1].props.push({ type: t[1], name: t[2] });
    }
  }
  const vertex = elements[0];
  if (!vertex || vertex.name !== "vertex") throw new Error("first PLY element is not vertex");
  const out = {};
  for (const p of vertex.props) out[p.name] = new Float32Array(vertex.count);
  if (format === "ascii") {
    const body = buf.subarray(headerEnd).toString("latin1").split(/\r?\n/);
    for (let i = 0; i < vertex.count; i++) {
      const vals = body[i].trim().split(/\s+/).map(Number);
      vertex.props.forEach((p, k) => (out[p.name][i] = vals[k]));
    }
    return { count: vertex.count, props: vertex.props.map((p) => p.name), data: out, comments: lines.filter((l) => l.startsWith("comment")) };
  }
  if (format !== "binary_little_endian") throw new Error("unsupported PLY format " + format);
  if (vertex.props.some((p) => p.list)) throw new Error("list properties in vertex element are not supported");
  const dv = new DataView(buf.buffer, buf.byteOffset + headerEnd);
  const layout = vertex.props.map((p) => ({ name: p.name, fn: plyTypes[p.type][0], size: plyTypes[p.type][1] }));
  let stride = 0;
  for (const l of layout) { l.offset = stride; stride += l.size; }
  for (let i = 0; i < vertex.count; i++) {
    const base = i * stride;
    for (const l of layout) out[l.name][i] = dv[l.fn](base + l.offset, true);
  }
  return { count: vertex.count, props: vertex.props.map((p) => p.name), data: out, stride, comments: lines.filter((l) => l.startsWith("comment")) };
}

// Standard 3DGS PLY (x y z f_dc_* opacity scale_* rot_*) -> encodeSpz arrays (SH degree 0).
export function gsplatFromPly(ply) {
  const d = ply.data, n = ply.count;
  const need = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"];
  const missing = need.filter((k) => !d[k]);
  if (missing.length) throw new Error("PLY is not a 3DGS file, missing " + missing.join(","));
  const positions = new Float32Array(n * 3), scales = new Float32Array(n * 3), quats = new Float32Array(n * 4), opacities = new Float32Array(n), colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = d.x[i]; positions[i * 3 + 1] = d.y[i]; positions[i * 3 + 2] = d.z[i];
    scales[i * 3] = Math.exp(d.scale_0[i]); scales[i * 3 + 1] = Math.exp(d.scale_1[i]); scales[i * 3 + 2] = Math.exp(d.scale_2[i]);
    quats[i * 4] = d.rot_1[i]; quats[i * 4 + 1] = d.rot_2[i]; quats[i * 4 + 2] = d.rot_3[i]; quats[i * 4 + 3] = d.rot_0[i];
    opacities[i] = 1 / (1 + Math.exp(-d.opacity[i]));
    colors[i * 3] = 0.5 + SH_C0 * d.f_dc_0[i]; colors[i * 3 + 1] = 0.5 + SH_C0 * d.f_dc_1[i]; colors[i * 3 + 2] = 0.5 + SH_C0 * d.f_dc_2[i];
  }
  return { n, positions, scales, quats, opacities, colors };
}

export function bboxOf(positions, n) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    const v = positions[i * 3 + k];
    if (v < min[k]) min[k] = v;
    if (v > max[k]) max[k] = v;
  }
  return { min, max };
}

// Rotation matrix with columns a1 a2 a3 (orthonormal, right-handed) -> quaternion xyzw.
export function quatFromBasis(a1x, a1y, a1z, a2x, a2y, a2z, a3x, a3y, a3z, out, o) {
  const m00 = a1x, m10 = a1y, m20 = a1z, m01 = a2x, m11 = a2y, m21 = a2z, m02 = a3x, m12 = a3y, m22 = a3z;
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  out[o] = x; out[o + 1] = y; out[o + 2] = z; out[o + 3] = w;
}

// three.js convention: lon 0 looks down -z, +lon turns toward +x, lat up is +y.
export function dirFromLonLat(lon, lat, out = [0, 0, 0]) {
  const c = Math.cos(lat);
  out[0] = c * Math.sin(lon); out[1] = Math.sin(lat); out[2] = -c * Math.cos(lon);
  return out;
}
export const lonLatFromDir = (x, y, z) => [Math.atan2(x, -z), Math.asin(Math.max(-1, Math.min(1, y / Math.hypot(x, y, z))))];

// Bilinear RGB sample of an equirect image (Uint8 RGB), wrapping in u.
export function sampleEquirect(img, W, H, lon, lat, out, o) {
  const fu = (lon / (2 * Math.PI) + 0.5) * W - 0.5;
  const fv = Math.min(H - 1, Math.max(0, (0.5 - lat / Math.PI) * H - 0.5));
  const u0 = Math.floor(fu), v0 = Math.floor(fv);
  const tu = fu - u0, tv = fv - v0;
  const ua = ((u0 % W) + W) % W, ub = (ua + 1) % W, va = v0, vb = Math.min(H - 1, v0 + 1);
  for (let c = 0; c < 3; c++) {
    const a = img[(va * W + ua) * 3 + c], b = img[(va * W + ub) * 3 + c], cc = img[(vb * W + ua) * 3 + c], d = img[(vb * W + ub) * 3 + c];
    out[o + c] = (a * (1 - tu) + b * tu) * (1 - tv) + (cc * (1 - tu) + d * tu) * tv;
  }
}
