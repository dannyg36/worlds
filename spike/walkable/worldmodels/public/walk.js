// worlds walkable spike, approach "worldmodels", GMI fallback: a branching walk.
// Pre-generated image-to-video camera moves (walk forward, turn left, turn right) from the day's eye-level image
// chain on the phone: swipe up, left or right to pick a move, swipe down to go back the way you came (a reversed clip).
const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const DAY = ["hackathon", "santa-cruz"].includes(q.get("day")) ? q.get("day") : "hackathon";
const CLIENT = Math.random().toString(16).slice(2, 10);
const now = () => performance.now();
const vids = [$("va"), $("vb")];
const poster = $("poster");
const S = { data: null, set: null, node: "start", busy: false, blobs: {}, bytes: 0, loadMs: null, active: null, path: [], moves: [], page: { fps: 0, ms: 0, worst: 0 }, cur: null, device: null, queued: null };
const LABEL = { forward: "walk", left: "turn left", right: "turn right", back: "back" };

function edges() { return S.data.sets[S.set].edges; }
function outgoing(node) { return edges().filter((e) => e.from === node); }
function incoming(node) { return edges().find((e) => e.id === node) || null; }
function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

function post(kind, extra) {
  const body = { kind, client: CLIENT, day: DAY, page: "walk", tag: q.get("tag"), set: S.set, model: S.data && S.set ? S.data.sets[S.set].model : null, node: S.node, path: S.path.join(">"), loaded_bytes: S.bytes, load_ms: S.loadMs, device: S.device, page_fps: +S.page.fps.toFixed(1), page_worst_ms: +S.page.worst.toFixed(1), ...extra };
  return fetch("/stats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
}

function hint(text, ms) {
  const el = $("hint");
  el.textContent = text;
  el.hidden = !text;
  clearTimeout(hint.t);
  if (ms) hint.t = setTimeout(() => (el.hidden = true), ms);
}

function renderArrows() {
  const out = outgoing(S.node).map((e) => e.move);
  for (const b of document.querySelectorAll("#arrows .arrow")) {
    const m = b.dataset.move;
    b.disabled = S.busy || (m === "back" ? !incoming(S.node) : !out.includes(m));
  }
  document.body.classList.toggle("busy", S.busy);
}

function hudText() {
  const set = S.data && S.set ? S.data.sets[S.set] : null;
  const c = S.cur;
  const lat = S.moves.map((m) => m.swipe_to_frame_ms).filter((x) => x != null);
  const last = S.moves[S.moves.length - 1];
  const v = S.active;
  return [
    "walk · " + DAY + " · " + (set ? S.set + " (" + set.model + ")" : "-"),
    "node " + S.node + (S.path.length ? "   path " + S.path.join(" > ") : "") + (S.busy ? "   moving" : ""),
    c ? "clip " + c.edge.id + (c.reverse ? " (reversed)" : "") + " " + c.edge.w + "x" + c.edge.h + " @" + c.edge.fps + "fps " + c.edge.dur + "s, " + (c.edge.bytes / 1e6).toFixed(1) + " MB" : "clip -",
    c ? "gen  " + c.edge.gen.model + ": " + c.edge.gen.latency_s + " s wall, " + c.edge.gen.server_s + " s on GMI, $" + c.edge.gen.cost_usd : "gen  -",
    last ? "last " + last.move + ": swipe->frame " + last.swipe_to_frame_ms + " ms, " + last.fps + " fps, dropped " + last.dropped + "/" + last.total : "last -",
    "moves " + S.moves.length + ", median swipe->frame " + (median(lat) ?? "-") + " ms",
    "video " + (v ? v.videoWidth + "x" + v.videoHeight : "-") + "   loaded " + Object.keys(S.blobs).length + " files " + (S.bytes / 1e6).toFixed(1) + " MB in " + (S.loadMs == null ? "-" : (S.loadMs / 1000).toFixed(1) + " s"),
    "page " + S.page.fps.toFixed(0) + " fps (" + S.page.ms.toFixed(1) + " ms, worst " + S.page.worst.toFixed(0) + ")   " + (S.device ? S.device.viewport + " @" + S.device.dpr + "x" : ""),
  ].join("\n");
}

let lastT = 0;
let worstReset = 0;
function pageLoop(t) {
  if (lastT) {
    const dt = t - lastT;
    S.page.ms = S.page.ms ? S.page.ms * 0.9 + dt * 0.1 : dt;
    S.page.fps = 1000 / S.page.ms;
    S.page.worst = Math.max(S.page.worst, dt);
  }
  if (t - worstReset > 3000) {
    worstReset = t;
    S.page.worst = 0;
  }
  lastT = t;
  $("hud").textContent = hudText();
  requestAnimationFrame(pageLoop);
}

function show(v) {
  v.classList.add("on");
  for (const o of vids) if (o !== v) o.classList.remove("on");
  poster.classList.add("gone");
  S.active = v;
}

function playClip(v, url) {
  return new Promise((resolve) => {
    const t0 = now();
    let first = null;
    let frames = 0;
    let tFirstMedia = null;
    let tLastMedia = null;
    const hasRvfc = "requestVideoFrameCallback" in v;
    const onFrame = (ts, meta) => {
      if (first == null) {
        first = now();
        show(v);
      }
      frames++;
      if (meta) {
        if (tFirstMedia == null) tFirstMedia = meta.mediaTime;
        tLastMedia = meta.mediaTime;
      }
      if (!v.ended) v.requestVideoFrameCallback(onFrame);
    };
    const done = () => {
      const q2 = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
      const wall = (now() - (first ?? t0)) / 1000;
      resolve({ swipe_to_frame_ms: first == null ? null : Math.round(first - t0), frames, fps: wall > 0 ? +(frames / wall).toFixed(1) : null, dropped: q2 ? q2.droppedVideoFrames : null, total: q2 ? q2.totalVideoFrames : null, wall_s: +wall.toFixed(2) });
    };
    v.onended = done;
    v.onerror = () => resolve({ error: "video error " + (v.error ? v.error.code : "?") });
    if (hasRvfc) v.requestVideoFrameCallback(onFrame);
    else v.addEventListener("playing", () => onFrame(), { once: true });
    v.src = url;
    v.currentTime = 0;
    const p = v.play();
    if (p) p.catch((e) => resolve({ error: "play failed: " + e.message }));
  });
}

async function go(move) {
  if (!S.data) return;
  if (S.busy) {
    S.queued = move;
    return;
  }
  let edge;
  let to;
  let reverse = false;
  if (move === "back") {
    edge = incoming(S.node);
    if (!edge) return hint("You're at the start", 1200);
    to = edge.from;
    reverse = true;
  } else {
    edge = outgoing(S.node).find((e) => e.move === move);
    if (!edge) return hint("No " + LABEL[move] + " clip from here yet", 1400);
    to = edge.id;
  }
  S.busy = true;
  renderArrows();
  hint("");
  S.cur = { edge, reverse };
  const next = vids.find((v) => v !== S.active) || vids[0];
  const url = reverse ? edge.rev : edge.src;
  const r = await playClip(next, S.blobs[url] || url);
  const from = S.node;
  S.node = to;
  if (reverse) S.path.pop();
  else S.path.push(move);
  const rec = { move, from, to, edge: edge.id, reverse, ...r };
  S.moves.push(rec);
  post("walk_move", rec);
  S.busy = false;
  renderArrows();
  if (S.queued) {
    const m = S.queued;
    S.queued = null;
    go(m);
  }
}

function setupSwipe() {
  const el = $("stage");
  let sx = 0;
  let sy = 0;
  let id = null;
  el.addEventListener("pointerdown", (e) => {
    id = e.pointerId;
    sx = e.clientX;
    sy = e.clientY;
  });
  el.addEventListener("pointerup", (e) => {
    if (e.pointerId !== id) return;
    id = null;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 40) return;
    if (Math.abs(dy) > Math.abs(dx)) go(dy < 0 ? "forward" : "back");
    else go(dx < 0 ? "left" : "right");
  });
  for (const b of document.querySelectorAll("#arrows .arrow")) b.addEventListener("click", () => go(b.dataset.move));
  addEventListener("keydown", (e) => {
    const m = { ArrowUp: "forward", KeyW: "forward", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowDown: "back", KeyS: "back" }[e.code];
    if (m) go(m);
  });
}

async function preload() {
  document.body.classList.remove("ready");
  const set = S.data.sets[S.set];
  const urls = set.edges.flatMap((e) => [e.src, e.rev]).filter((u) => !S.blobs[u]);
  const t0 = now();
  let done = 0;
  $("bar").style.width = "0%";
  $("sub").textContent = set.edges.length + " moves from " + set.model + ", loading " + urls.length + " clips…";
  await Promise.all(urls.map(async (u) => {
    const b = await (await fetch(u)).blob();
    S.blobs[u] = URL.createObjectURL(b);
    S.bytes += b.size;
    done++;
    $("bar").style.width = Math.round((100 * done) / urls.length) + "%";
  }));
  S.loadMs = Math.round(now() - t0);
  S.node = "start";
  S.path = [];
  S.cur = null;
  for (const v of vids) {
    v.classList.remove("on");
    v.removeAttribute("src");
  }
  S.active = null;
  poster.classList.remove("gone");
  document.body.classList.add("ready");
  renderArrows();
  hint("Swipe up to walk, left or right to turn, down to go back", 3500);
  post("walk_load", { clips: urls.length });
}

async function boot() {
  requestAnimationFrame(pageLoop);
  S.device = { ua: navigator.userAgent, dpr: devicePixelRatio, viewport: innerWidth + "x" + innerHeight, rvfc: "requestVideoFrameCallback" in HTMLVideoElement.prototype, cores: navigator.hardwareConcurrency ?? null };
  const [data, scenes] = await Promise.all([fetch("/assets/walk/" + DAY + ".json", { cache: "no-store" }).then((r) => r.json()), fetch("/scenes.json").then((r) => r.json()).catch(() => null)]);
  S.data = data;
  $("title").textContent = scenes?.days?.[DAY]?.title || DAY;
  poster.src = data.start;
  const sel = $("set");
  for (const k of Object.keys(data.sets)) sel.append(new Option(k + " · " + data.sets[k].edges.length + " moves", k));
  S.set = data.sets[q.get("set")] ? q.get("set") : Object.keys(data.sets)[0];
  sel.value = S.set;
  sel.addEventListener("change", () => {
    S.set = sel.value;
    preload();
  });
  $("btn-hud").addEventListener("click", () => document.body.classList.toggle("nohud"));
  $("btn-fit").addEventListener("click", () => document.body.classList.toggle("fill"));
  if (q.has("fill")) document.body.classList.add("fill");
  if (q.has("nohud")) document.body.classList.add("nohud");
  setupSwipe();
  await preload();
}

boot().catch((e) => {
  $("sub").textContent = "Failed: " + e.message;
  post("walk_error", { error: String(e.message || e) });
});
