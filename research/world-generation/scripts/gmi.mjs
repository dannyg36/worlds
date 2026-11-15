const KEY = process.env.GMI_API_KEY;
if (!KEY) throw new Error("GMI_API_KEY missing");
export const redact = (s) => String(s).split(KEY).join("[redacted]");
export const QUEUE = "https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey";
export const LLM = "https://api.gmi-serving.com/v1";
export async function call(method, url, body, timeoutMs = 120000) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = redact(await res.text());
    let json;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, ms: Date.now() - started, json, text: json === undefined ? text.slice(0, 3000) : undefined };
  } catch (error) {
    return { status: 0, ms: Date.now() - started, error: redact(error?.message ?? error) };
  }
}
export const show = (value) => console.log(redact(JSON.stringify(value, null, 2)));
