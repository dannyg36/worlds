import { call, show, QUEUE } from "./gmi.mjs";
const r = await call("GET", QUEUE + "/requests?limit=100&offset=0");
const hy = (r.json?.requests ?? []).filter((q) => q.model === "hunyuan-3d-pro").slice(0, Number(process.argv[2] ?? 12)).map((q) => ({ id: q.request_id.slice(0, 8), status: q.status, created: new Date(q.created_at * 1000).toISOString().slice(11, 19), updated: new Date(q.updated_at * 1000).toISOString().slice(11, 19), faces: q.payload?.face_count, type: q.payload?.generate_type, pbr: q.payload?.enable_pbr, prompt: q.payload?.prompt ? "text" : "image", err: q.outcome?.error, media: q.outcome?.media_urls?.map((m) => ({ ...m, url: undefined, file: (m.url ?? "").split("?")[0].split("/").pop() })) }));
show({ now: new Date().toISOString().slice(11, 19), hy });
