const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function http(url, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 2000) };
  }
  return { status: res.status, ok: res.ok, body: json };
}

function key(name) {
  const value = process.env[name];
  if (!value) throw new Error(name + " is not set");
  return value;
}

function collectUrls(value, found = []) {
  if (typeof value === "string" && /^https?:\/\//.test(value)) found.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectUrls(v, found));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectUrls(v, found));
  return found;
}

const fal = {
  async run(model, input, { timeoutMs, pollMs = 500 }) {
    const headers = { Authorization: "Key " + key("FAL_KEY") };
    const t0 = performance.now();
    const at = () => Number(((performance.now() - t0) / 1000).toFixed(3));
    const timeline = { submitted_at: new Date().toISOString() };
    const submit = await http("https://queue.fal.run/" + model, { method: "POST", body: input, headers });
    timeline.submit_ack_s = at();
    if (!submit.ok) return { ok: false, stage: "submit", http: submit.status, error: submit.body, timeline };
    const { request_id, status_url, response_url, cancel_url } = submit.body;
    while (true) {
      if (performance.now() - t0 > timeoutMs) {
        await http(cancel_url, { method: "PUT", headers }).catch(() => {});
        timeline.timeout_s = at();
        return { ok: false, stage: "timeout", request_id, timeline };
      }
      const status = await http(status_url, { headers });
      const state = status.body?.status;
      if (state === "IN_PROGRESS" && timeline.processing_s === undefined) timeline.processing_s = at();
      if (state === "COMPLETED") {
        timeline.completed_s = at();
        timeline.server_inference_s = status.body.metrics?.inference_time ?? null;
        break;
      }
      await sleep(pollMs);
    }
    const result = await http(response_url, { headers });
    timeline.result_s = at();
    if (!result.ok || result.body?.detail) return { ok: false, stage: "result", http: result.status, request_id, error: result.body, timeline };
    return { ok: true, request_id, result: result.body, urls: collectUrls(result.body), timeline };
  },
};

const GMI_QUEUE = "https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey";

const gmi = {
  async run(model, payload, { timeoutMs, pollMs = 1000 }) {
    const headers = { Authorization: "Bearer " + key("GMI_API_KEY") };
    const t0 = performance.now();
    const at = () => Number(((performance.now() - t0) / 1000).toFixed(3));
    const timeline = { submitted_at: new Date().toISOString() };
    const submit = await http(GMI_QUEUE + "/requests", { method: "POST", body: { model, payload }, headers });
    timeline.submit_ack_s = at();
    if (!submit.ok || !submit.body?.request_id) return { ok: false, stage: "submit", http: submit.status, error: submit.body, timeline };
    const request_id = submit.body.request_id;
    let detail = submit.body;
    while (true) {
      const state = detail?.status;
      if (state === "processing" && timeline.processing_s === undefined) timeline.processing_s = at();
      if (state === "success" && detail.outcome) break;
      if (state === "failed" || state === "cancelled") {
        timeline.failed_s = at();
        return { ok: false, stage: state, request_id, error: detail.outcome ?? detail.error ?? detail, timeline, server: serverTimes(detail) };
      }
      if (performance.now() - t0 > timeoutMs) {
        timeline.timeout_s = at();
        return { ok: false, stage: "timeout", request_id, last_status: state, timeline, server: serverTimes(detail) };
      }
      await sleep(pollMs);
      const res = await http(GMI_QUEUE + "/requests/" + request_id, { headers });
      if (res.ok) detail = res.body;
    }
    timeline.result_s = at();
    if (timeline.processing_s === undefined) timeline.processing_s = null;
    const urls = (detail.outcome?.media_urls ?? []).map((m) => (typeof m === "string" ? m : m.url)).filter(Boolean);
    return { ok: true, request_id, result: { ...detail, payload: undefined }, urls, timeline, server: serverTimes(detail) };
  },
};

function serverTimes(detail) {
  if (!detail) return null;
  const out = {};
  for (const [k, v] of Object.entries(detail)) if (/_at$/.test(k) && typeof v === "number") out[k] = v;
  return out;
}

export const PROVIDERS = { fal, gmi };

export async function runJob(provider, model, input, opts = {}) {
  const adapter = PROVIDERS[provider];
  if (!adapter) throw new Error("unknown provider " + provider);
  return adapter.run(model, input, { timeoutMs: 900_000, ...opts });
}
