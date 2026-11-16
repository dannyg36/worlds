// worlds walkable spike, approach "worldmodels": drive a live fal world model over WebRTC from a phone.
import { fal } from "@fal-ai/client";
import { wma } from "@fal-ai/client/realtime/wma";

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const DAY = ["hackathon", "santa-cruz"].includes(q.get("day")) ? q.get("day") : "hackathon";
const MOCK = q.has("mock");
const CLIENT = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2)).replace(/-/g, "").slice(0, 8);
const video = $("world");
const poster = $("poster");
const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtS = (ms) => (ms == null ? "-" : (ms / 1000).toFixed(1) + "s");
const short = (id) => (id || "").split("/").pop();

const pcs = [];
const NativePC = window.RTCPeerConnection;
if (NativePC) {
  window.RTCPeerConnection = class extends NativePC {
    constructor(...args) {
      super(...args);
      pcs.push(this);
    }
  };
}

const QUICK = {
  hackathon: [
    { key: 1, title: "Cheer", description: "Everyone around the table throws their arms up and cheers as the little 3D world appears on the monitor." },
    { key: 2, title: "Pizza", description: "Someone grabs a slice of cold pizza from the open box on the floor." },
    { key: 3, title: "Golden hour", description: "The sunset through the big windows glows brighter and warmer, flooding the office with gold." },
  ],
  "santa-cruz": [
    { key: 1, title: "Sea lions", description: "The sea lions on the wharf pilings lift their heads and bark at each other." },
    { key: 2, title: "Big wave", description: "A big wave rolls in and a surfer rides it toward the cliffs." },
    { key: 3, title: "Fog lifts", description: "The last wisps of fog lift off the water and the noon sun gets brighter." },
  ],
};

const S = {
  models: {}, modelId: null, model: null, scene: null, style: "", imageUrl: null, localPoster: null, replayClip: null, status: {}, gpu: {}, device: {}, load: {},
  mode: "idle", session: null, ended: null, tClick: 0, marks: {}, configured: false, configuredPrompt: null, sessionInfo: null, serverStats: null,
  msgCounts: {}, lastError: null, billable: null, controlsEnabled: false,
  frames: { count: 0, lastCount: 0, lastT: 0, fps: 0, w: 0, h: 0 },
  page: { last: 0, acc: 0, n: 0, fps: 0, ms: 0, worst: 0 },
  rtp: {}, net: {}, pingRtt: null, bytesAtLive: null,
  held: { move: new Set(), look: new Set(), act: new Set(), keys: new Set(), probe: new Set() },
  sentKey: "", commandsSent: 0, cmdLog: [],
  motion: [], lastThumb: null, posterThumb: null, posterMatch: null,
  rec: null, recChunks: [], recMime: "", recStartedAt: 0, autoRec: q.get("rec") === "1",
  timers: [], testLog: [], latency: [],
};

function mark(name) {
  if (S.marks[name] == null) S.marks[name] = Math.round(now() - S.tClick);
}

async function getJson(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(url + " " + r.status);
  return r.json();
}

function post(kind, extra = {}) {
  const body = {
    kind, client: CLIENT, day: DAY, model: S.modelId, mode: S.mode, t_ms: Math.round(now() - (S.tClick || 0)),
    marks: S.marks, video: { w: video.videoWidth, h: video.videoHeight, fps: +S.frames.fps.toFixed(1), frames: S.frames.count },
    rtp: S.rtp, net: S.net, ping_rtt_ms: S.pingRtt, page: { fps: +S.page.fps.toFixed(1), frame_ms: +S.page.ms.toFixed(1), worst_ms: +S.page.worst.toFixed(1) },
    server_stats: S.serverStats, billable_units: S.billable, commands_sent: S.commandsSent, msg_counts: S.msgCounts, last_error: S.lastError,
    gpu: S.gpu, device: S.device, load: S.load, est_cost_usd: estCost(), session_s: sessionSeconds(), ...extra,
  };
  return fetch("/stats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: kind === "session_end" }).catch(() => {});
}

function sessionSeconds() {
  if (S.marks.state_live == null) return 0;
  const end = S.marks.end ?? Math.round(now() - S.tClick);
  return Math.max(0, (end - S.marks.state_live) / 1000);
}

function estCost() {
  if (!S.model || S.mode === "replay" || MOCK) return 0;
  const s = sessionSeconds();
  if (!s) return 0;
  return +(Math.max(s, S.model.min_billable_s || 0) * S.model.price_usd_per_s).toFixed(4);
}

function toast(text, ms) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = !text;
  clearTimeout(toast.t);
  if (ms) toast.t = setTimeout(() => (el.hidden = true), ms);
}

function setMode(mode) {
  S.mode = mode;
  document.body.classList.toggle("idle", mode === "idle");
  document.body.classList.toggle("connecting", mode === "opening" || mode === "connecting");
  document.body.classList.toggle("replay", mode === "replay");
  $("btn-end").hidden = mode === "idle";
  $("clock").hidden = !(mode === "live" || mode === "connecting" || mode === "opening");
}

function scenePrompt() {
  const sc = S.scene;
  const eye = sc.eye_level_prompt.replace(/\s*Stylized 3D animated-film look[^.]*\./i, "").trim().replace(/\.$/, "");
  const objs = (sc.objects || []).map((o) => o.prompt).join("; ");
  const ground = sc.ground?.type || "ground";
  return [
    S.style + ".",
    "First-person exploration at eye level. " + eye + ".",
    objs ? "Around you: " + objs + "." : "",
    sc.time_of_day[0].toUpperCase() + sc.time_of_day.slice(1) + ", " + sc.weather + "; palette " + sc.palette + ".",
    "Smooth steady first-person walking camera at eye height, stable upright horizon, no cuts, no text.",
    "Navigation-ready: open " + ground + " visible ahead, furniture, objects and people beside the path, no stairs or narrow doorways.",
  ].filter(Boolean).join(" ").slice(0, 1990);
}

function configureMessage() {
  const prompt = scenePrompt();
  const image_url = S.imageUrl || undefined;
  switch (S.model.family) {
    case "lingbot":
      return { type: "configure", image_url, prompt, enable_prompt_expansion: q.get("expand") !== "0", enable_safety_checker: true, quick_actions: QUICK[DAY] };
    case "abot":
      return { type: "configure", image_url, prompt };
    case "eden":
      return { type: "configure", game: q.get("game") || S.model.default_game, hud: "none", autopilot: false, prompt, image_url };
    case "h3":
      return {
        type: "configure", protocol_version: 1, prompt_version: 1, resolution: "480p", aspect_ratio: "16:9", memory: 12, num_inference_steps: 10,
        prompt: S.style + ". A continuous first-person walk through the scene in the reference image, steady camera, no cuts. " + S.scene.eye_level_prompt,
        reference_images: image_url ? [{ url: image_url, name: "Day" }] : [],
      };
    default:
      return null;
  }
}

function attachStream(stream) {
  mark("media");
  if (video.srcObject !== stream) video.srcObject = stream;
  video.muted = true;
  video.play().catch(() => toast("Tap to play", 3000));
}

function onMessage(raw) {
  let m;
  try {
    m = JSON.parse(raw);
  } catch {
    return;
  }
  if (!m || typeof m.type !== "string") return;
  S.msgCounts[m.type] = (S.msgCounts[m.type] || 0) + 1;
  switch (m.type) {
    case "session_info":
      S.sessionInfo = m;
      mark("session_info");
      post("session_info", { info: m });
      break;
    case "configured":
      S.configured = true;
      S.configuredPrompt = m.prompt ?? null;
      mark("configured");
      post("configured", { configured: m });
      if (S.frames.count > 0 && !S.marks.world_frame) toast("Building your world…");
      break;
    case "stats":
      S.serverStats = m;
      if (m.billable_units != null) S.billable = m.billable_units;
      break;
    case "pong": {
      const ts = m.ts ?? m.client_ts;
      if (typeof ts === "number") S.pingRtt = Math.round(now() - ts);
      break;
    }
    case "quick_actions_state":
      S.quickState = m.actions;
      renderActions();
      break;
    case "controls_state":
      S.controls = m.controls;
      break;
    case "stream_exhausted":
      mark("stream_exhausted");
      end("stream_exhausted");
      break;
    case "error":
      S.lastError = String(m.error).slice(0, 300);
      post("model_error", { error: m });
      break;
    default:
      if (/applied|pending|rejected/.test(m.type)) mark(m.type);
  }
}

function onDiagnostic(d) {
  if (d.kind === "progress") {
    if (d.phase === "ice-servers") {
      mark("ice_servers");
      S.iceSource = d.detail?.source;
    } else if (d.phase === "ice-gathering" && d.detail?.state) {
      mark("ice_gathered_" + d.detail.state);
      S.iceGather = d.detail;
    } else if (d.phase === "connection-state") {
      mark("pc_" + d.detail?.state);
      S.pcState = d.detail?.state;
      if (d.detail?.state === "connected") toast("Connected. Streaming…");
    }
  } else if (d.kind === "failure" || d.kind === "warning") {
    S.lastError = (d.message || "").slice(0, 300);
    post("diagnostic", { diagnostic: d });
  }
}

async function startLive() {
  S.tClick = now();
  S.marks = {};
  S.ended = null;
  setMode("opening");
  toast("Waiting for a world runner…");
  let session;
  try {
    session = fal.realtime.open(wma(S.modelId), {
      receive: S.model.receive,
      negotiationTimeoutMs: 90000,
      onState: (st) => {
        mark("state_" + st);
        S.rtState = st;
        if (st === "live") {
          setMode("connecting");
          toast("Runner found. Connecting…");
          startClock();
        }
        if (st === "failed" && !S.ended) end("failed");
      },
      onMedia: attachStream,
      onData: onMessage,
      onError: (e) => {
        S.lastError = String(e?.message || e).slice(0, 300);
        post("error", { error: S.lastError });
      },
      onDiagnostic,
    });
  } catch (e) {
    S.lastError = String(e?.message || e);
    return end("open-threw");
  }
  S.session = session;
  try {
    await session.ready;
  } catch (e) {
    S.lastError = S.lastError || String(e?.message || e).slice(0, 300);
    if (!S.ended) end("negotiation-failed");
    return;
  }
  mark("ready");
  const cfg = configureMessage();
  if (cfg) {
    session.send(cfg);
    mark("configure_sent");
  }
  S.timers.push(setInterval(() => S.session?.send({ type: "ping", ts: now() }), 2000));
  S.timers.push(setTimeout(() => end("client-cap"), (S.model.max_session_s || 120) * 1000));
  S.timers.push(setTimeout(() => {
    if (!S.marks.world_frame && S.frames.count > 0) worldVisible("fallback-no-configured");
  }, 45000));
}

function worldVisible(reason) {
  if (S.marks.world_frame != null) return;
  mark("world_frame");
  S.worldReason = reason;
  setMode("live");
  document.body.classList.add("live");
  toast("");
  enableControls(true);
  post("world_visible", { reason, ttff_ms: S.marks.world_frame });
  if (S.autoRec && !S.rec) startRec();
}

function enableControls(on) {
  S.controlsEnabled = on;
  for (const id of ["joy", "look"]) $(id).hidden = !on;
  $("actions").hidden = !on || !(S.model?.quick_actions || MOCK);
  if (on) renderActions();
}

function renderActions() {
  const box = $("actions");
  box.innerHTML = "";
  if (!S.model?.quick_actions) return;
  for (const a of QUICK[DAY]) {
    const b = document.createElement("button");
    b.type = "button";
    const st = S.quickState?.find((x) => x.key === a.key);
    b.textContent = a.title + (st && !st.ready ? " …" : "");
    const cmd = "quick_action_" + a.key;
    const down = (e) => {
      e.preventDefault();
      S.held.act.add(cmd);
      b.classList.add("held");
      pushCommands();
    };
    const up = () => {
      S.held.act.delete(cmd);
      b.classList.remove("held");
      pushCommands();
    };
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    b.addEventListener("pointerleave", up);
    box.appendChild(b);
  }
}

function allowedCommands() {
  const base = S.model?.commands || [];
  const qa = S.model?.quick_actions ? [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => "quick_action_" + n) : [];
  return new Set([...base, ...qa]);
}

function activeCommands() {
  const allowed = allowedCommands();
  const all = new Set([...S.held.move, ...S.held.look, ...S.held.act, ...S.held.keys, ...S.held.probe]);
  return [...all].filter((c) => allowed.has(c) || MOCK).sort();
}

function pushCommands(force) {
  if (!S.controlsEnabled) return;
  const active = activeCommands();
  const key = active.join(",");
  if (key === S.sentKey && !force) return;
  const prev = new Set(S.sentKey ? S.sentKey.split(",") : []);
  const activated = active.filter((c) => !prev.has(c));
  S.sentKey = key;
  S.lastCmdAt = now();
  S.commandsSent++;
  S.cmdLog.push([Math.round(now() - S.tClick), key]);
  if (S.cmdLog.length > 400) S.cmdLog.shift();
  if (!MOCK) S.session?.send({ type: "commands", active, activated });
}

function releaseAll() {
  for (const k of Object.keys(S.held)) S.held[k].clear();
  pushCommands();
}

function setupJoystick() {
  const el = $("joy");
  const knob = $("knob");
  let id = null;
  let cx = 0;
  let cy = 0;
  const R = 54;
  const move = (e) => {
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx *= R / d;
      dy *= R / d;
    }
    knob.style.transform = "translate(" + dx + "px," + dy + "px)";
    const set = S.held.move;
    set.clear();
    if (dy / R < -0.4) set.add("forward");
    if (dy / R > 0.4) set.add("backward");
    if (dx / R < -0.4) set.add("left");
    if (dx / R > 0.4) set.add("right");
    pushCommands();
  };
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    id = e.pointerId;
    el.setPointerCapture(id);
    const r = el.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    move(e);
  });
  el.addEventListener("pointermove", (e) => e.pointerId === id && move(e));
  const up = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    knob.style.transform = "";
    S.held.move.clear();
    pushCommands();
  };
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) el.addEventListener(t, up);
}

function setupLook() {
  const el = $("look");
  const dot = $("lookdot");
  let id = null;
  let ox = 0;
  let oy = 0;
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    id = e.pointerId;
    el.setPointerCapture(id);
    ox = e.clientX;
    oy = e.clientY;
    const r = el.getBoundingClientRect();
    dot.style.left = ox - r.left + "px";
    dot.style.top = oy - r.top + "px";
    dot.style.display = "block";
  });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - ox;
    const dy = e.clientY - oy;
    const set = S.held.look;
    set.clear();
    if (dx > 18) set.add("look_right");
    if (dx < -18) set.add("look_left");
    if (dy < -30) set.add("look_up");
    if (dy > 30) set.add("look_down");
    pushCommands();
  });
  const up = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    dot.style.display = "none";
    S.held.look.clear();
    pushCommands();
  };
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) el.addEventListener(t, up);
}

const KEYMAP = { KeyW: "forward", ArrowUp: "forward", KeyS: "backward", ArrowDown: "backward", KeyA: "left", KeyD: "right", ArrowLeft: "look_left", ArrowRight: "look_right", KeyQ: "look_left", KeyE: "look_right", KeyR: "look_up", KeyF: "look_down", Space: "jump" };
function setupKeys() {
  addEventListener("keydown", (e) => {
    const c = KEYMAP[e.code] || (/^Digit[1-9]$/.test(e.code) ? "quick_action_" + e.code.slice(5) : null);
    if (!c || e.repeat) return;
    S.held.keys.add(c);
    pushCommands();
  });
  addEventListener("keyup", (e) => {
    const c = KEYMAP[e.code] || (/^Digit[1-9]$/.test(e.code) ? "quick_action_" + e.code.slice(5) : null);
    if (!c) return;
    S.held.keys.delete(c);
    pushCommands();
  });
  addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", () => document.hidden && releaseAll());
}

const thumbCanvas = document.createElement("canvas");
thumbCanvas.width = 48;
thumbCanvas.height = 27;
const thumbCtx = thumbCanvas.getContext("2d", { willReadFrequently: true });
function thumb(src) {
  try {
    thumbCtx.drawImage(src, 0, 0, 48, 27);
    const d = thumbCtx.getImageData(0, 0, 48, 27).data;
    const g = new Float32Array(48 * 27);
    for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    return g;
  } catch {
    return null;
  }
}
function ncc(a, b) {
  if (!a || !b) return null;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= a.length;
  mb /= b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da && db ? +(num / Math.sqrt(da * db)).toFixed(3) : null;
}
function meanAbsDiff(a, b) {
  if (!a || !b) return null;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

let lastSample = 0;
function onVideoFrame(ts, meta) {
  const f = S.frames;
  f.count++;
  f.w = meta?.width || video.videoWidth;
  f.h = meta?.height || video.videoHeight;
  if (S.mode !== "replay") {
    mark("first_frame");
    if (S.configured && S.marks.world_frame == null) worldVisible("configured");
    if (!S.configured && MOCK && S.marks.world_frame == null) worldVisible("mock");
  }
  const t = meta?.expectedDisplayTime || ts;
  if (t - lastSample > 30) {
    lastSample = t;
    const g = thumb(video);
    if (g) {
      const m = meanAbsDiff(g, S.lastThumb);
      if (m != null) S.motion.push({ t, m });
      if (S.motion.length > 600) S.motion.splice(0, 200);
      S.lastThumb = g;
      if (S.posterThumb && S.configured && S.posterMatch == null) {
        const sim = ncc(g, S.posterThumb);
        if (sim != null && sim > 0.55) {
          S.posterMatch = sim;
          mark("poster_match");
        }
      }
    }
  }
  S.waiters = (S.waiters || []).filter((w) => !w(t));
  video.requestVideoFrameCallback(onVideoFrame);
}

function pageLoop(t) {
  const p = S.page;
  if (p.last) {
    const dt = t - p.last;
    p.acc += dt;
    p.n++;
    p.worst = Math.max(p.worst, dt);
    if (p.acc >= 1000) {
      p.fps = (p.n * 1000) / p.acc;
      p.ms = p.acc / p.n;
      p.acc = 0;
      p.n = 0;
      const f = S.frames;
      f.fps = ((f.count - f.lastCount) * 1000) / Math.max(1, t - (f.lastT || t - 1000));
      f.lastCount = f.count;
      f.lastT = t;
      setTimeout(() => (p.worst = 0), 0);
    }
  }
  p.last = t;
  requestAnimationFrame(pageLoop);
}

async function pollStats() {
  const pc = pcs[pcs.length - 1];
  if (!pc || pc.connectionState === "closed") return;
  let report;
  try {
    report = await pc.getStats();
  } catch {
    return;
  }
  const byId = new Map();
  report.forEach((r) => byId.set(r.id, r));
  let inbound = null;
  let pair = null;
  report.forEach((r) => {
    if (r.type === "inbound-rtp" && (r.kind || r.mediaType) === "video") inbound = r;
    if (r.type === "transport" && r.selectedCandidatePairId) pair = byId.get(r.selectedCandidatePairId);
  });
  if (!pair) report.forEach((r) => r.type === "candidate-pair" && r.nominated && r.state === "succeeded" && (pair = r));
  const t = now();
  if (inbound) {
    const prev = S.rtp;
    const codec = inbound.codecId ? byId.get(inbound.codecId) : null;
    const kbps = prev.bytes != null && t > prev.t ? Math.round(((inbound.bytesReceived - prev.bytes) * 8) / (t - prev.t)) : null;
    if (S.bytesAtLive == null && S.marks.world_frame != null) S.bytesAtLive = inbound.bytesReceived;
    S.rtp = {
      t, bytes: inbound.bytesReceived, kbps, fps: inbound.framesPerSecond ?? null, w: inbound.frameWidth ?? null, h: inbound.frameHeight ?? null,
      decoded: inbound.framesDecoded, dropped: inbound.framesDropped ?? null, lost: inbound.packetsLost, freezes: inbound.freezeCount ?? null,
      jitter_ms: inbound.jitter != null ? Math.round(inbound.jitter * 1000) : null,
      jb_ms: inbound.jitterBufferEmittedCount ? Math.round((1000 * inbound.jitterBufferDelay) / inbound.jitterBufferEmittedCount) : null,
      decode_ms: inbound.framesDecoded ? +((1000 * (inbound.totalDecodeTime || 0)) / inbound.framesDecoded).toFixed(2) : null,
      codec: codec?.mimeType || null, decoder: inbound.decoderImplementation || null,
    };
  }
  if (pair) {
    const local = byId.get(pair.localCandidateId);
    const remote = byId.get(pair.remoteCandidateId);
    S.net = {
      local: local?.candidateType, remote: remote?.candidateType, proto: local?.protocol, relay_proto: local?.relayProtocol || null,
      rtt_ms: pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
    };
  }
}

function hudText() {
  const m = S.model || {};
  const mk = S.marks;
  const r = S.rtp;
  const n = S.net;
  const ss = S.serverStats || {};
  const lines = [];
  const mode = S.mode === "replay" ? "REPLAY of a recorded session" : MOCK ? "MOCK stream (no fal)" : S.rtState || S.mode;
  lines.push((m.label || "-") + " · " + DAY + " · " + mode);
  if (S.mode !== "replay") {
    const cap = m.max_session_s || 120;
    lines.push("session " + sessionSeconds().toFixed(0) + "/" + cap + "s · ~$" + estCost().toFixed(3) + (S.billable != null ? " · billed " + S.billable.toFixed(1) + "s" : "") + " · pc " + (S.pcState || "-"));
    lines.push("ttff " + fmtS(mk.world_frame) + " (runner " + fmtS(mk.state_live) + " · media " + fmtS(mk.media) + " · 1st frame " + fmtS(mk.first_frame) + " · cfg " + fmtS(mk.configured) + ")");
    lines.push("ice " + (n.local || "-") + "/" + (n.remote || "-") + " " + (n.proto || "") + (n.relay_proto ? "(turn " + n.relay_proto + ")" : "") + " · rtt " + (n.rtt_ms ?? "-") + "ms · ping " + (S.pingRtt ?? "-") + "ms");
  }
  lines.push("video " + (video.videoWidth || 0) + "x" + (video.videoHeight || 0) + " · " + S.frames.fps.toFixed(1) + " fps shown" + (r.fps != null ? " · rtp " + r.fps : "") + (r.kbps != null ? " · " + (r.kbps / 1000).toFixed(1) + " Mb/s" : ""));
  if (r.codec || r.decode_ms != null) lines.push((r.codec || "-") + " · dec " + (r.decode_ms ?? "-") + "ms · jb " + (r.jb_ms ?? "-") + "ms · drop " + (r.dropped ?? "-") + " · lost " + (r.lost ?? "-") + " · frz " + (r.freezes ?? "-"));
  if (r.bytes) lines.push("received " + (r.bytes / 1e6).toFixed(1) + " MB");
  if (ss.generation_fps != null || ss.realtime_factor != null) lines.push("model gen " + (ss.generation_fps != null ? (+ss.generation_fps).toFixed(1) : "-") + " fps" + (ss.realtime_factor != null ? " · rt " + (+ss.realtime_factor).toFixed(2) : "") + (ss.input_latency_ms != null ? " · in→frame " + Math.round(ss.input_latency_ms) + "ms" : "") + (ss.queue_depth != null ? " · q " + ss.queue_depth : ""));
  if (S.latency.length) lines.push("input→motion " + S.latency.map((x) => (x == null ? "x" : Math.round(x))).join("/") + " ms");
  lines.push("page " + S.page.fps.toFixed(0) + " fps · " + S.page.ms.toFixed(1) + " ms (worst " + S.page.worst.toFixed(0) + ") · " + (S.gpu.renderer || "-") + " · " + (S.gpu.webgl || "-"));
  lines.push("load " + fmtS(S.load.ready_ms) + " · js " + Math.round((S.load.js_bytes || 0) / 1024) + "KB/" + (S.load.js_files || 0) + " files · poster " + Math.round((S.load.poster_bytes || 0) / 1024) + "KB in " + fmtS(S.load.poster_ms));
  if (S.lastError) lines.push("err " + S.lastError.slice(0, 90));
  if (S.mode === "idle") return lines.slice(-3).reverse().filter((l) => !l.startsWith("err")).concat(S.lastError ? ["err " + S.lastError.slice(0, 90)] : []).join("\n");
  return lines.join("\n");
}

function startClock() {
  const el = $("clock");
  const tick = () => {
    if (S.mode === "idle" || S.ended) return;
    const s = sessionSeconds();
    const cap = S.model.max_session_s || 120;
    el.textContent = Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0") + " / " + Math.floor(cap / 60) + ":" + String(cap % 60).padStart(2, "0") + " · ~$" + estCost().toFixed(3);
  };
  S.timers.push(setInterval(tick, 500));
  tick();
}

function pickMime() {
  const types = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
}

function startRec() {
  const stream = video.srcObject;
  if (!stream || !window.MediaRecorder) return toast("Recording not available", 2000);
  S.recMime = pickMime();
  try {
    S.rec = new MediaRecorder(stream, S.recMime ? { mimeType: S.recMime, videoBitsPerSecond: 8_000_000 } : undefined);
  } catch (e) {
    S.rec = null;
    return toast("Recorder failed: " + e.message, 3000);
  }
  S.recChunks = [];
  S.recStartedAt = now();
  S.rec.ondataavailable = (e) => e.data && e.data.size && S.recChunks.push(e.data);
  S.rec.onstop = uploadRec;
  S.rec.start(1000);
  $("btn-rec").classList.add("on");
}

function stopRec() {
  if (S.rec && S.rec.state !== "inactive") S.rec.stop();
  $("btn-rec").classList.remove("on");
}

async function uploadRec() {
  const chunks = S.recChunks;
  S.rec = null;
  if (!chunks.length) return;
  const type = (S.recMime || chunks[0].type || "video/webm").split(";")[0];
  const blob = new Blob(chunks, { type });
  const name = DAY + "_" + short(S.modelId || "mock") + "_" + CLIENT;
  const secs = ((now() - S.recStartedAt) / 1000).toFixed(1);
  toast("Uploading clip " + (blob.size / 1e6).toFixed(1) + " MB…");
  try {
    const r = await fetch("/clip?name=" + encodeURIComponent(name), { method: "POST", headers: { "content-type": type }, body: blob });
    const j = await r.json();
    toast("Clip saved (" + (blob.size / 1e6).toFixed(1) + " MB)", 2500);
    post("clip", { clip: j, clip_bytes: blob.size, clip_s: +secs, clip_type: type });
  } catch (e) {
    toast("Clip upload failed", 2500);
  }
}

async function snap(name) {
  if (!video.videoWidth) return null;
  const c = document.createElement("canvas");
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext("2d").drawImage(video, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
  if (!blob) return null;
  const r = await fetch("/snap?name=" + encodeURIComponent(DAY + "_" + short(S.modelId || "mock") + "_" + CLIENT + "_" + name), { method: "POST", headers: { "content-type": "image/jpeg" }, body: blob }).catch(() => null);
  return r ? (await r.json()).saved : null;
}

function out(line) {
  S.testLog.push(line);
  $("testout").textContent = S.testLog.slice(-14).join("\n");
}

function waitFrame(pred, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = now();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    (S.waiters = S.waiters || []).push((t) => {
      if (now() - t0 > timeoutMs) return true;
      if (pred(t)) {
        clearTimeout(timer);
        resolve(t);
        return true;
      }
      return false;
    });
  });
}

function recentMotion(ms) {
  const t = now();
  const xs = S.motion.filter((x) => t - x.t < ms).map((x) => x.m);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

async function holdFor(cmds, ms) {
  S.held.probe = new Set(cmds);
  pushCommands();
  await sleep(ms);
  S.held.probe.clear();
  pushCommands();
}

async function testLatency() {
  out("latency probe: 4 x look_right from rest");
  const res = [];
  for (let i = 0; i < 4 && S.controlsEnabled; i++) {
    releaseAll();
    await sleep(1800);
    const base = recentMotion(900) ?? 1;
    const thr = Math.max(base * 2.5, base + 2.5);
    const t0 = now();
    S.held.probe = new Set([i % 2 ? "look_left" : "look_right"]);
    pushCommands();
    const hit = await waitFrame(() => {
      const last = S.motion[S.motion.length - 1];
      return last && last.t > t0 && last.m > thr;
    }, 4000);
    await sleep(600);
    S.held.probe.clear();
    pushCommands();
    const lat = hit ? Math.round(hit - t0) : null;
    res.push(lat);
    out("  #" + (i + 1) + " base " + base.toFixed(1) + " thr " + thr.toFixed(1) + " → " + (lat ?? "no motion in 4s") + " ms");
  }
  S.latency = res;
  const ok = res.filter((x) => x != null).sort((a, b) => a - b);
  const median = ok.length ? ok[Math.floor(ok.length / 2)] : null;
  out("median " + (median ?? "-") + " ms");
  post("latency_probe", { latency_ms: res, latency_median_ms: median });
}

async function testTurn() {
  out("turn away and back: look_right 3s, look_left 3s");
  releaseAll();
  await sleep(1500);
  const a = thumb(video);
  const sa = await snap("turn-A-start");
  await holdFor(["look_right"], 3000);
  await sleep(400);
  const b = thumb(video);
  const sb = await snap("turn-B-away");
  await holdFor(["look_left"], 3000);
  await sleep(700);
  const c = thumb(video);
  const sc = await snap("turn-C-back");
  const r = { ncc_start_away: ncc(a, b), ncc_start_back: ncc(a, c), snaps: [sa, sb, sc] };
  out("  start~away " + r.ncc_start_away + " · start~back " + r.ncc_start_back);
  post("turn_probe", r);
}

async function testWalk() {
  out("walk out and back: forward 3s, backward 3s");
  releaseAll();
  await sleep(1200);
  const a0 = thumb(video);
  await sleep(2000);
  const a = thumb(video);
  const sa = await snap("walk-A-start");
  await holdFor(["forward"], 3000);
  await sleep(400);
  const b = thumb(video);
  const sb = await snap("walk-B-out");
  await holdFor(["backward"], 3000);
  await sleep(700);
  const c = thumb(video);
  const sc = await snap("walk-C-back");
  const r = { ncc_idle_2s: ncc(a0, a), ncc_start_out: ncc(a, b), ncc_start_back: ncc(a, c), snaps: [sa, sb, sc] };
  out("  idle " + r.ncc_idle_2s + " · start~out " + r.ncc_start_out + " · start~back " + r.ncc_start_back);
  post("walk_probe", r);
}

async function testSpin() {
  out("full turn: hold look_right up to 14s, track similarity to the start view");
  releaseAll();
  await sleep(1500);
  const a = thumb(video);
  const sa = await snap("spin-A-start");
  const t0 = now();
  S.held.probe = new Set(["look_right"]);
  pushCommands();
  const curve = [];
  let best = { sim: -1, t: 0 };
  let left = false;
  while (now() - t0 < 14000 && S.controlsEnabled) {
    await sleep(250);
    const sim = ncc(a, thumb(video));
    const dt = Math.round(now() - t0);
    curve.push([dt, sim]);
    if (sim != null && sim < 0.3) left = true;
    if (left && sim != null && sim > best.sim) best = { sim, t: dt };
  }
  S.held.probe.clear();
  pushCommands();
  await sleep(300);
  const sb = await snap("spin-B-end");
  const minSim = Math.min(...curve.map((x) => x[1] ?? 1));
  out("  min " + minSim.toFixed(2) + " · best return " + best.sim.toFixed(2) + " at " + best.t + "ms");
  post("spin_probe", { curve, best_return: best, min_sim: minSim, snaps: [sa, sb] });
}

async function testIce() {
  out("ICE probe: gather candidates with a public STUN server (no fal)");
  const pc = new NativePC({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  pc.createDataChannel("probe");
  const cands = [];
  pc.onicecandidate = (e) => e.candidate && e.candidate.candidate && cands.push(e.candidate.candidate);
  const t0 = now();
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((r) => {
    const t = setTimeout(r, 6000);
    pc.onicegatheringstatechange = () => pc.iceGatheringState === "complete" && (clearTimeout(t), r());
  });
  const types = {};
  for (const c of cands) {
    const typ = / typ (\w+)/.exec(c)?.[1] || "?";
    const proto = (c.split(" ")[2] || "?").toLowerCase();
    types[typ + "/" + proto] = (types[typ + "/" + proto] || 0) + 1;
  }
  pc.close();
  const ms = Math.round(now() - t0);
  out("  " + JSON.stringify(types) + " in " + ms + " ms");
  post("ice_probe", { ice_types: types, candidates: cands.length, gather_ms: ms });
}

async function runTest(name) {
  if (name === "ice") return testIce();
  if (!S.controlsEnabled) return out("start a world first");
  if (S.testing) return out("a test is running");
  S.testing = true;
  try {
    if (name === "latency") await testLatency();
    if (name === "turn") await testTurn();
    if (name === "walk") await testWalk();
    if (name === "spin") await testSpin();
    if (name === "snap") out("snapshot " + (await snap("manual")));
  } finally {
    S.testing = false;
  }
}

async function end(reason) {
  if (S.ended) return;
  S.ended = reason;
  mark("end");
  for (const t of S.timers) {
    clearInterval(t);
    clearTimeout(t);
  }
  S.timers = [];
  enableControls(false);
  stopRec();
  const summary = {
    reason, session_s: +sessionSeconds().toFixed(1), est_cost_usd: estCost(), configured_prompt: S.configuredPrompt, session_info: S.sessionInfo,
    bytes_after_world: S.bytesAtLive != null && S.rtp.bytes ? S.rtp.bytes - S.bytesAtLive : null, cmd_log_tail: S.cmdLog.slice(-60), ice_source: S.iceSource, ice_gather: S.iceGather,
  };
  if (S.session && !MOCK) {
    try {
      S.session.send({ type: "stop" });
    } catch {}
    await sleep(200);
    try {
      await S.session.close();
    } catch {}
  }
  if (S.mockTimer) clearInterval(S.mockTimer);
  for (const pc of S.loopbackPcs || []) pc.close();
  S.loopbackPcs = null;
  await post("session_end", summary);
  S.session = null;
  document.body.classList.remove("live");
  video.srcObject = null;
  video.removeAttribute("src");
  setMode("idle");
  toast("");
  $("day-eyebrow").textContent = "World closed · " + reason;
  $("model-note").textContent = "Last session " + summary.session_s + " s · ~$" + summary.est_cost_usd.toFixed(3) + " · first view " + fmtS(S.marks.world_frame) + ". Start again to rebuild the same world from the same image and prompt.";
}

function startReplay() {
  S.tClick = now();
  S.marks = {};
  setMode("replay");
  video.srcObject = null;
  video.src = S.replayClip;
  video.loop = true;
  video.play().catch(() => toast("Tap to play", 2000));
  toast("Recorded session (live worlds need FAL_KEY on the server)", 3500);
}

async function loopback(stream) {
  const a = new RTCPeerConnection();
  const b = new RTCPeerConnection();
  a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate).catch(() => {});
  b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate).catch(() => {});
  const got = new Promise((res) => (b.ontrack = (e) => res(e.streams[0] || new MediaStream([e.track]))));
  for (const t of stream.getTracks()) a.addTrack(t, stream);
  const tr = a.getTransceivers()[0];
  const caps = window.RTCRtpSender?.getCapabilities?.("video");
  if (caps && tr?.setCodecPreferences) {
    const h264 = caps.codecs.filter((c) => /h264/i.test(c.mimeType));
    try {
      if (h264.length) tr.setCodecPreferences([...h264, ...caps.codecs.filter((c) => !/h264/i.test(c.mimeType))]);
    } catch {}
  }
  await a.setLocalDescription(await a.createOffer());
  await b.setRemoteDescription(a.localDescription);
  await b.setLocalDescription(await b.createAnswer());
  await a.setRemoteDescription(b.localDescription);
  try {
    const sender = a.getSenders()[0];
    const p = sender.getParameters();
    if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    p.encodings[0].maxBitrate = 8000000;
    await sender.setParameters(p);
  } catch {}
  S.loopbackPcs = [a, b];
  return got;
}

function startMock() {
  S.tClick = now();
  S.marks = {};
  S.ended = null;
  setMode("connecting");
  mark("state_live");
  const c = $("mockcanvas");
  c.width = Number(q.get("w") || 960);
  c.height = Number(q.get("h") || 540);
  const mockFps = Number(q.get("fps") || 30);
  const ctx = c.getContext("2d");
  let yaw = 0;
  let pitch = 0;
  let x = 0;
  let z = 0;
  let last = now();
  const img = S.localPoster && poster.complete && poster.naturalWidth ? poster : null;
  const draw = () => {
    const t = now();
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    const h = new Set(activeCommands());
    if (h.has("look_left")) yaw -= 70 * dt;
    if (h.has("look_right")) yaw += 70 * dt;
    if (h.has("look_up")) pitch = Math.max(-25, pitch - 40 * dt);
    if (h.has("look_down")) pitch = Math.min(25, pitch + 40 * dt);
    const a = (yaw * Math.PI) / 180;
    const sp = 2.2 * dt;
    if (h.has("forward")) { x += Math.sin(a) * sp; z += Math.cos(a) * sp; }
    if (h.has("backward")) { x -= Math.sin(a) * sp; z -= Math.cos(a) * sp; }
    if (h.has("left")) { x -= Math.cos(a) * sp; z += Math.sin(a) * sp; }
    if (h.has("right")) { x += Math.cos(a) * sp; z -= Math.sin(a) * sp; }
    const W = c.width;
    const H = c.height;
    const hor = H * 0.45 + pitch * 6;
    const sky = ctx.createLinearGradient(0, 0, 0, hor);
    sky.addColorStop(0, "#f7c873");
    sky.addColorStop(1, "#e2774b");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, hor);
    if (img) {
      const pw = W * 2;
      const off = (((yaw / 360) * pw) % pw + pw) % pw;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(img, -off, hor - H * 0.55, pw, H * 0.55);
      ctx.drawImage(img, pw - off, hor - H * 0.55, pw, H * 0.55);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = "#6b4a2f";
    ctx.fillRect(0, hor, W, H - hor);
    ctx.strokeStyle = "rgba(255,230,190,.45)";
    ctx.lineWidth = 1.5;
    for (let i = -12; i <= 12; i++) {
      const gx = i - (x % 1);
      ctx.beginPath();
      ctx.moveTo(W / 2 + (gx - yaw / 30) * 4, hor);
      ctx.lineTo(W / 2 + (gx - yaw / 30) * 160, H);
      ctx.stroke();
    }
    for (let k = 1; k < 14; k++) {
      const dz = k - (z % 1);
      const y = hor + (H - hor) * (1 / Math.max(0.15, dz)) * 0.35;
      if (y > H) continue;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(0,0,0,.5)";
    ctx.fillRect(10, 10, 300, 26);
    ctx.fillStyle = "#fff";
    ctx.font = "16px system-ui";
    ctx.fillText("MOCK stream · yaw " + yaw.toFixed(0) + " · " + [...h].join(","), 16, 28);
  };
  draw();
  S.mockTimer = setInterval(draw, 1000 / mockFps);
  const stream = c.captureStream(mockFps);
  if (q.get("loopback") === "1") {
    mark("loopback_start");
    loopback(stream).then((s2) => {
      mark("loopback_track");
      attachStream(s2);
    }).catch((e) => {
      S.lastError = "loopback: " + e.message;
      attachStream(stream);
    });
  } else attachStream(stream);
  S.configured = true;
  mark("configured");
  startClock();
  S.timers.push(setTimeout(() => end("client-cap"), 120000));
}

function gpuInfo() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return { webgl: "none" };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const info = {
      webgl: typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext ? "webgl2" : "webgl1",
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      max_texture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    };
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return info;
  } catch (e) {
    return { webgl: "error " + e.message };
  }
}

async function deviceInfo() {
  const d = {
    ua: navigator.userAgent, platform: navigator.platform, dpr: devicePixelRatio, screen: screen.width + "x" + screen.height, viewport: innerWidth + "x" + innerHeight,
    cores: navigator.hardwareConcurrency ?? null, memory_gb: navigator.deviceMemory ?? null, touch: navigator.maxTouchPoints,
    rvfc: "requestVideoFrameCallback" in HTMLVideoElement.prototype, media_recorder: !!window.MediaRecorder, rec_mime: pickMime(), webrtc: !!window.RTCPeerConnection,
  };
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    d.media_devices = devs.map((x) => x.kind).join(",");
  } catch {
    d.media_devices = "n/a";
  }
  return d;
}

function loadInfo() {
  const nav = performance.getEntriesByType("navigation")[0];
  const res = performance.getEntriesByType("resource");
  const js = res.filter((r) => /\.js(\?|$)|\+esm/.test(r.name));
  const pst = res.find((r) => poster.src && r.name === poster.src);
  return {
    dom_ms: nav ? Math.round(nav.domContentLoadedEventEnd) : null, ready_ms: S.readyAt ?? Math.round(now()),
    js_files: js.length, js_bytes: js.reduce((s, r) => s + (r.encodedBodySize || r.transferSize || 0), 0), js_transfer: js.reduce((s, r) => s + (r.transferSize || 0), 0),
    js_ms: js.length ? Math.round(Math.max(...js.map((r) => r.responseEnd))) : null,
    poster_bytes: pst ? pst.encodedBodySize || pst.transferSize || null : null, poster_ms: pst ? Math.round(pst.responseEnd - pst.startTime) : null, poster_url: poster.src || null,
  };
}

async function boot() {
  requestAnimationFrame(pageLoop);
  if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) video.requestVideoFrameCallback(onVideoFrame);
  fal.config({
    proxyUrl: "/api/fal/proxy",
    requestMiddleware: async (req) => ({ ...req, headers: { ...(req.headers || {}), "x-wm-label": DAY + ":" + short(S.modelId) + ":" + CLIENT } }),
  });
  const [modelsJson, scenes, inputs, status, local] = await Promise.all([
    getJson("/models.json"),
    getJson("/scenes.json"),
    getJson("/inputs.json").catch(() => ({ days: {} })),
    getJson("/api/status").catch(() => ({ fal_key: false })),
    getJson("/assets/index.json").catch(() => ({})),
  ]);
  S.models = modelsJson.models;
  S.status = status;
  S.scene = scenes.days[DAY];
  S.style = scenes.style;
  const dayInputs = inputs.days?.[DAY] || {};
  const eyeKey = Object.keys(dayInputs).find((k) => /eye/i.test(k));
  const eyeVal = eyeKey ? dayInputs[eyeKey] : null;
  S.imageUrl = q.get("image") || (typeof eyeVal === "string" ? eyeVal : eyeVal?.url) || null;
  S.localPoster = local?.[DAY]?.eye_level || null;
  S.replayClip = local?.[DAY]?.replay || null;
  const posterSrc = S.localPoster || S.imageUrl;
  if (posterSrc) {
    if (S.localPoster) poster.crossOrigin = "anonymous";
    poster.src = posterSrc;
    poster.decode?.().then(() => (S.posterThumb = S.localPoster ? thumb(poster) : null)).catch(() => {});
  }
  $("day-title").textContent = S.scene.title || DAY;
  $("day-eyebrow").textContent = DAY === "hackathon" ? "Tonight's world · the hackathon" : "Tonight's world · Santa Cruz";
  $("day-transcript").textContent = "“" + S.scene.transcript + "”";
  const sel = $("model");
  const wanted = q.get("model") || modelsJson.default;
  if (MOCK) sel.add(new Option("Mock stream (no fal, tests the controls)", "mock"));
  for (const [id, m] of Object.entries(S.models)) {
    const o = new Option(m.label + " · $" + (m.price_usd_per_s * 60).toFixed(3) + "/min", id);
    if (!status.fal_key && !MOCK) o.disabled = true;
    sel.add(o);
  }
  if (S.replayClip) sel.add(new Option("Replay a recorded session", "replay"));
  sel.value = MOCK ? "mock" : !status.fal_key && S.replayClip ? "replay" : S.models[wanted] ? wanted : modelsJson.default;
  const onPick = () => {
    S.modelId = sel.value;
    S.model = S.models[sel.value] || { label: sel.value === "mock" ? "Mock stream" : "Replay", family: sel.value, commands: ["forward", "backward", "left", "right", "look_up", "look_down", "look_left", "look_right"], price_usd_per_s: 0, max_session_s: 120 };
    const m = S.model;
    $("model-note").textContent = S.models[sel.value]
      ? "Live " + m.declared_video.width + "x" + m.declared_video.height + " @ " + m.declared_video.fps + " fps · $" + (m.price_usd_per_s * 60).toFixed(3) + " per minute · max " + m.max_session_s + " s" + (status.fal_key ? "" : " · server has no FAL_KEY")
      : sel.value === "replay" ? "Plays a session recorded on " + (local?.[DAY]?.replay_model || "a world model") + "." : "Local canvas stream to test controls and the HUD.";
  };
  sel.addEventListener("change", onPick);
  onPick();
  $("btn-start").disabled = false;
  $("btn-start").addEventListener("click", () => {
    if (S.mode !== "idle") return;
    S.frames.count = 0;
    S.configured = false;
    S.configuredPrompt = null;
    S.sessionInfo = null;
    S.serverStats = null;
    S.msgCounts = {};
    S.lastError = null;
    S.posterMatch = null;
    S.bytesAtLive = null;
    S.rtp = {};
    S.net = {};
    S.pingRtt = null;
    S.sentKey = "";
    S.latency = [];
    S.ended = null;
    S.billable = null;
    if (sel.value === "replay") return startReplay();
    if (sel.value === "mock") return startMock();
    startLive();
  });
  $("btn-end").addEventListener("click", () => (S.mode === "replay" ? end("user-replay") : end("user")));
  $("btn-hud").addEventListener("click", () => document.body.classList.toggle("nohud"));
  $("btn-fit").addEventListener("click", () => document.body.classList.toggle("fill"));
  $("btn-rec").addEventListener("click", () => (S.rec ? stopRec() : startRec()));
  $("btn-tests").addEventListener("click", () => ($("tests").hidden = !$("tests").hidden));
  for (const b of document.querySelectorAll("#tests button")) b.addEventListener("click", () => runTest(b.dataset.test));
  addEventListener("pagehide", () => S.session && end("pagehide"));
  setupJoystick();
  setupLook();
  setupKeys();
  if (q.has("nohud")) document.body.classList.add("nohud");
  if (q.has("fill")) document.body.classList.add("fill");
  S.readyAt = Math.round(now());
  S.gpu = gpuInfo();
  S.device = await deviceInfo();
  setTimeout(() => {
    S.load = loadInfo();
    post("boot");
  }, 1500);
  setInterval(() => {
    $("hud").textContent = hudText();
  }, 250);
  setInterval(() => {
    pollStats();
  }, 1000);
  setInterval(() => {
    if (S.mode === "live" || S.mode === "connecting") post("tick");
  }, 5000);
  if (q.get("autostart") === "1") setTimeout(() => $("btn-start").click(), 800);
}

boot().catch((e) => {
  $("day-title").textContent = "Failed to load";
  $("model-note").textContent = String(e?.message || e);
});
