#!/usr/bin/env node
// Runs the scene writer (system prompt = SCHEMA.md) on GMI Cloud.
// Usage:
//   node spike/procedural/gen.mjs --day birthday-dinner --mode text|image [--model <id>] [--image <path>] [--paint] [--dry-run]
// --mode image sends the concept image (default research/3d-bakeoff/sample-worlds/<day>/concept.png).
// --paint (image mode) first paints a fresh concept with gpt-image-2.5-flare-generate on GMI's request queue.
// --dry-run prints the request bodies (image truncated) and calls nothing.
// Needs GMI_API_KEY unless --dry-run. Node 20+, no dependencies.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { formatStats, validate } from "./validate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const SCHEMA = join(HERE, "SCHEMA.md");
const DAYS = join(ROOT, "docs/3d-worlds/sample-days.md");
const LLM_CATALOG = join(ROOT, "research/3d-bakeoff/catalog/gmi-llm-models.json");
const LEDGER = join(HERE, "gen-ledger.jsonl");

const CHAT_URL = "https://api.gmi-serving.com/v1/chat/completions";
const QUEUE_URL = "https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/requests";
const DEFAULT_MODEL = "google/gemini-3.8-flash"; // what convex/generation/models.ts uses
const CHAT_TIMEOUT_MS = 180_000;
const IMAGE_MAX_PX = 768; // concept images are downscaled to a JPEG this size before sending
const TMP = process.env.CLAUDE_JOB_DIR ? join(process.env.CLAUDE_JOB_DIR, "tmp") : tmpdir();

// Concept painter. Never send quality "auto": GMI bills it at the top tier.
const PAINT_MODEL = "gpt-image-2.5-flare-generate";
const PAINT_USD = 0.0059; // model card price at 1024x1024, quality low
const PAINT_TIMEOUT_MS = 180_000;
const POLL_MS = 2_000;

// Clay house style from research/art-direction/scene-writer/styles.json, with the camera
// changed from a three-quarter view to the hero camera (+z, 30 degrees up).
const CLAY_LEAD =
  "A handmade stop-motion claymation diorama of a tiny world, sculpted entirely from soft matte plasticine with visible thumbprints and gently rounded edges, sitting on a thick round wooden base. In the diorama:";
const CLAY_LOOK = "Chunky, slightly squashed proportions and little clay figures with simple bead eyes.";
const CLAY_GUARD =
  "The whole world is one compact object, centered, filling about two thirds of the frame with empty space on every side, seen straight from the front and about 30 degrees above. Nothing extends beyond its edges: no horizon, sky or distant scenery behind it. Show only what is described: no extra people or animals. Plain seamless warm off-white background with nothing else in it. Soft, even, diffuse light with only a gentle contact shadow; everything in crisp focus. No text, letters, numbers, signs or logos anywhere.";

const IMAGE_INSTRUCTION = `The attached image is a concept painting of this diorama. Its camera is the hero camera: on +z, looking at the centre from 30 degrees up. Reproduce its layout faithfully: the same place, the same objects in the same positions and the same colours, light and time of day. Map positions by screen direction: image left to right is -x to +x, the bottom of the image is the front (+z) and the top is the back (-z), even if the base in the image is turned. Scale the layout to fill the 9 m base. The voice note decides who is there; the image decides where things are and what they look like.`;

function usage(message) {
  if (message) console.error(`gen.mjs: ${message}`);
  console.error(
    "usage: node spike/procedural/gen.mjs --day <slug> --mode text|image [--model <id>] [--image <path>] [--paint] [--dry-run]",
  );
  process.exit(2);
}

function parseCli(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        day: { type: "string" },
        mode: { type: "string" },
        model: { type: "string", default: DEFAULT_MODEL },
        image: { type: "string" },
        paint: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    }));
  } catch (error) {
    usage(error.message);
  }
  if (values.help) usage();
  if (!values.day) usage("--day is required");
  if (values.mode !== "text" && values.mode !== "image") usage("--mode must be text or image");
  if (values.mode === "text" && (values.image || values.paint)) usage("--image and --paint need --mode image");
  if (values.image && values.paint) usage("use --image or --paint, not both");
  return {
    day: values.day,
    mode: values.mode,
    model: values.model,
    paint: values.paint,
    dryRun: values["dry-run"],
    image: values.image
      ? resolve(values.image)
      : values.paint
        ? join(HERE, "out", `${values.day}.concept.png`)
        : join(ROOT, "research/3d-bakeoff/sample-worlds", values.day, "concept.png"),
  };
}

function readTranscript(day) {
  const days = {};
  for (const section of readFileSync(DAYS, "utf8").split(/^## /m).slice(1)) {
    const [slug, ...body] = section.split("\n");
    days[slug.trim()] = body.join("\n").trim();
  }
  if (!days[day]) throw new Error(`no day "${day}" in ${relative(ROOT, DAYS)}; known: ${Object.keys(days).join(", ")}`);
  return days[day];
}

function imageDataUrl(path) {
  const types = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
  const type = types[extname(path).toLowerCase()];
  if (!type) throw new Error(`unsupported image type: ${path}`);
  return `data:${type};base64,${readFileSync(path).toString("base64")}`;
}

// Downscales to a 768 px JPEG with macOS sips; sends the original if sips isn't available.
function shrinkImage(path) {
  const out = join(TMP, `gen-${basename(path, extname(path))}-${process.pid}.jpg`);
  try {
    mkdirSync(TMP, { recursive: true });
    execFileSync("sips", ["-Z", String(IMAGE_MAX_PX), "-s", "format", "jpeg", "-s", "formatOptions", "80", path, "--out", out], {
      stdio: "ignore",
    });
  } catch (error) {
    console.log(`image: sips failed (${error.message}); sending ${relative(ROOT, path)} as is`);
    return path;
  }
  const kb = (file) => Math.round(statSync(file).size / 1024);
  console.log(`image: ${relative(ROOT, path)} (${kb(path)} KB) -> ${IMAGE_MAX_PX} px JPEG (${kb(out)} KB)`);
  return out;
}

function buildMessages({ mode, transcript, imageUrl }) {
  const note = `Voice note:\n"""\n${transcript}\n"""\n\nWrite the scene spec for this day as one JSON object.`;
  const user =
    mode === "text"
      ? note
      : [
          { type: "text", text: `${note}\n\n${IMAGE_INSTRUCTION}` },
          { type: "image_url", image_url: { url: imageUrl } },
        ];
  return [
    { role: "system", content: readFileSync(SCHEMA, "utf8") },
    { role: "user", content: user },
  ];
}

function chatBody(model, messages) {
  return {
    model,
    messages,
    temperature: 0.8,
    max_tokens: 8_000, // reasoning tokens come out of this too
    // Streaming keeps bytes flowing, so Cloudflare's ~100 s gateway timeout (HTTP 524) can't fire.
    stream: true,
    stream_options: { include_usage: true },
    reasoning_effort: "low",
    response_format: { type: "json_object" },
  };
}

function paintPrompt(transcript) {
  return `${CLAY_LEAD} the single most visual moment of this day, told in the person's own words: "${transcript}" Show that moment's place on the base, with any walls or buildings cut down to a fragment along the back edge and the front left open. People are small stylized figures. ${CLAY_LOOK} ${CLAY_GUARD}`;
}

const paintBody = (prompt) => ({
  model: PAINT_MODEL,
  payload: { prompt, size: "1024x1024", quality: "low", output_format: "png", background: "opaque" },
});

// Pretty-prints a request with base64 images cut short.
function redactImages(body) {
  return JSON.stringify(
    body,
    (key, value) =>
      typeof value === "string" && value.startsWith("data:")
        ? `${value.slice(0, 48)}...[${value.length - 48} more chars]`
        : value,
    2,
  );
}

// ---------- HTTP ----------

class ProviderError extends Error {}

// Returns parsed JSON, or the Response itself when `raw` is set and the status is OK.
async function gmi(url, { method = "GET", body, timeoutMs, raw = false }) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${process.env.GMI_API_KEY}`, "Content-Type": "application/json" },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ProviderError(
      error.name === "TimeoutError" ? `GMI took longer than ${timeoutMs / 1000}s` : `GMI request failed: ${error.message}`,
    );
  }
  if (raw && response.ok) return response;
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!response.ok) {
    const page = text.match(/<title>([^<]*)<\/title>/i)?.[1]; // gateway errors (e.g. Cloudflare 524) are HTML
    const detail = json?.error?.message ?? json?.error ?? json?.detail ?? json?.message ?? page?.trim() ?? text.slice(0, 300);
    const error = new ProviderError(`GMI ${response.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    error.status = response.status;
    throw error;
  }
  if (json === undefined) throw new ProviderError(`GMI returned non-JSON: ${text.slice(0, 200)}`);
  return json;
}

// ---------- cost ----------

function llmPrices(model) {
  try {
    const entry = JSON.parse(readFileSync(LLM_CATALOG, "utf8")).data.find((m) => m.id === model);
    const p = entry?.pricing;
    if (p) return { prompt: +p.prompt, completion: +p.completion, cacheRead: +(p.input_cache_read ?? p.prompt) };
  } catch {}
  return null;
}

function callCost(prices, usage) {
  if (!prices || !usage) return null;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return (
    (usage.prompt_tokens - cached) * prices.prompt +
    cached * prices.cacheRead +
    usage.completion_tokens * prices.completion
  );
}

const money = (usd) => (usd == null ? "unknown" : `$${usd.toFixed(4)}`);

// ---------- steps ----------

async function paint(day, transcript, outPath) {
  const t0 = Date.now();
  const submitted = await gmi(QUEUE_URL, { method: "POST", body: paintBody(paintPrompt(transcript)), timeoutMs: PAINT_TIMEOUT_MS });
  const id = submitted.request_id;
  if (typeof id !== "string") throw new ProviderError(`GMI queue returned no request_id: ${JSON.stringify(submitted).slice(0, 200)}`);
  console.log(`paint: ${PAINT_MODEL} request ${id}`);
  // Sync models can answer "success" on submit without an outcome, so always GET the request.
  let status;
  for (;;) {
    status = await gmi(`${QUEUE_URL}/${id}`, { timeoutMs: 30_000 });
    if (["success", "failed", "cancelled"].includes(status.status)) break;
    if (Date.now() - t0 > PAINT_TIMEOUT_MS) throw new ProviderError(`paint request ${id} still ${status.status} after ${PAINT_TIMEOUT_MS / 1000}s`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  if (status.status !== "success") {
    throw new ProviderError(`paint request ${id} ${status.status}: ${JSON.stringify(status.outcome ?? {}).slice(0, 300)}`);
  }
  const url = status.outcome?.media_urls?.[0]?.url ?? status.outcome?.media_urls?.[0];
  if (typeof url !== "string") throw new ProviderError(`paint request ${id} has no media url`);
  const image = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!image.ok) throw new ProviderError(`downloading the concept failed with ${image.status}`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(await image.arrayBuffer()));
  const ms = Date.now() - t0;
  console.log(`paint: ${ms} ms, ${money(PAINT_USD)}, saved ${relative(ROOT, outPath)}`);
  return { ms, requestId: id, usd: PAINT_USD };
}

let plainChat = false; // set once a model rejects JSON mode or reasoning_effort

async function chat(model, messages) {
  const t0 = Date.now();
  const { response_format, reasoning_effort, stream_options, ...plain } = chatBody(model, messages);
  let response;
  try {
    response = await gmi(CHAT_URL, {
      method: "POST",
      body: plainChat ? plain : { ...plain, response_format, reasoning_effort, stream_options },
      timeoutMs: CHAT_TIMEOUT_MS,
      raw: true,
    });
  } catch (error) {
    // Some models reject JSON mode, reasoning_effort or stream_options; try once without them and strip fences instead.
    if (error.status !== 400 || plainChat) throw error;
    console.log(`  ${error.message}; retrying once without response_format, reasoning_effort and stream_options`);
    plainChat = true;
    response = await gmi(CHAT_URL, { method: "POST", body: plain, timeoutMs: CHAT_TIMEOUT_MS, raw: true });
  }
  let reply;
  try {
    reply = await readReply(response);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      error.name === "TimeoutError" ? `GMI took longer than ${CHAT_TIMEOUT_MS / 1000}s` : `GMI stream failed: ${error.message}`,
    );
  }
  return { ms: Date.now() - t0, ...reply, usage: reply.usage ?? estimateUsage(messages, reply.content) };
}

// Reads a server-sent event stream of chat chunks, or a plain JSON reply if the server didn't stream.
// GMI's stream doesn't reliably say text/event-stream, so sniff the body instead of the header.
async function readReply(response) {
  const text = await response.text();
  if (!/^\s*data:/.test(text)) {
    const json = JSON.parse(text);
    const choice = json.choices?.[0];
    let content = choice?.message?.content;
    if (Array.isArray(content)) content = content.map((part) => part.text ?? "").join("");
    return { content: content ?? "", finish: choice?.finish_reason, usage: json.usage };
  }
  let content = "";
  let finish;
  let usage;
  const handle = (line) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data);
    if (event.error) throw new ProviderError(`GMI stream error: ${event.error.message ?? JSON.stringify(event.error)}`);
    const choice = event.choices?.[0];
    content += choice?.delta?.content ?? "";
    finish = choice?.finish_reason ?? finish;
    if (event.usage) usage = event.usage;
  };
  for (const line of text.split("\n")) handle(line.trim());
  return { content, finish, usage };
}

// Rough count for when the stream carries no usage: ~4 characters a token, ~258 tokens an image.
// It can't see reasoning tokens, so it undercounts reasoning models.
function estimateUsage(messages, content) {
  let chars = 0;
  let images = 0;
  for (const message of messages) {
    for (const part of [].concat(message.content)) {
      if (typeof part === "string") chars += part.length;
      else if (part.type === "text") chars += part.text.length;
      else images++;
    }
  }
  return { prompt_tokens: Math.round(chars / 4) + images * 258, completion_tokens: Math.round(content.length / 4), estimated: true };
}

function parseSpec(content, finish) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  let text = fenced ? fenced[1] : content;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try {
    return { spec: JSON.parse(text) };
  } catch (error) {
    const cut = finish === "length" ? " (the reply hit max_tokens and was cut off)" : "";
    return { parseError: `reply is not valid JSON${cut}: ${error.message}` };
  }
}

function logCall(n, call, prices) {
  const u = call.usage ?? {};
  const reasoning = u.completion_tokens_details?.reasoning_tokens;
  console.log(
    `call ${n}: ${call.ms} ms, ${u.estimated ? "~" : ""}${u.prompt_tokens ?? "?"} in / ${u.completion_tokens ?? "?"} out` +
      `${reasoning ? ` (${reasoning} reasoning)` : ""} tokens, finish ${call.finish ?? "?"}, ${money(callCost(prices, call.usage))}`,
  );
}

async function main() {
  const args = parseCli(process.argv.slice(2));
  const transcript = readTranscript(args.day);
  const label = args.paint ? "paint" : args.mode;
  const outPath = join(HERE, "scenes", `${args.day}.${label}.gmi.json`);

  if (args.dryRun) {
    if (args.paint) {
      console.log(`--- POST ${QUEUE_URL}`);
      console.log(JSON.stringify(paintBody(paintPrompt(transcript)), null, 2));
    }
    const imageUrl =
      args.mode === "image"
        ? existsSync(args.image)
          ? imageDataUrl(shrinkImage(args.image))
          : `<data URL of the painted concept, ${relative(ROOT, args.image)}>`
        : undefined;
    console.log(`--- POST ${CHAT_URL}`);
    console.log(redactImages(chatBody(args.model, buildMessages({ mode: args.mode, transcript, imageUrl }))));
    console.log(`--- would write ${relative(ROOT, outPath)}`);
    return;
  }

  if (!process.env.GMI_API_KEY) {
    console.error("gen.mjs: GMI_API_KEY is not set. Export it (never commit or print it) and rerun.");
    process.exit(1);
  }
  if (args.mode === "image" && !args.paint && !existsSync(args.image)) {
    throw new Error(`no image at ${args.image}`);
  }

  const t0 = Date.now();
  const prices = llmPrices(args.model);
  if (!prices) console.log(`no price for ${args.model} in ${relative(ROOT, LLM_CATALOG)}; cost is unknown`);
  const record = { ts: new Date().toISOString(), day: args.day, mode: args.mode, paint: args.paint, model: args.model };
  const calls = [];
  try {
    if (args.paint) record.paintStep = await paint(args.day, transcript, args.image);
    if (args.mode === "image") record.image = relative(ROOT, args.image);

    const messages = buildMessages({
      mode: args.mode,
      transcript,
      imageUrl: args.mode === "image" ? imageDataUrl(shrinkImage(args.image)) : undefined,
    });
    console.log(`model: ${args.model} (${args.mode} mode${args.paint ? ", painted concept" : ""})`);

    let call = await chat(args.model, messages);
    calls.push(call);
    logCall(1, call, prices);
    let { spec, parseError } = parseSpec(call.content, call.finish);
    let result = spec ? validate(spec) : { errors: [parseError], warnings: [], stats: null };

    if (result.errors.length) {
      console.log(`${result.errors.length} errors, repairing once:`);
      for (const e of result.errors) console.log(`  ${e}`);
      messages.push(
        { role: "assistant", content: call.content },
        {
          role: "user",
          content: `Your spec has these errors:\n${result.errors.map((e) => `- ${e}`).join("\n")}\n\nFix them and output the complete corrected JSON object, nothing else.`,
        },
      );
      call = await chat(args.model, messages);
      calls.push(call);
      logCall(2, call, prices);
      ({ spec, parseError } = parseSpec(call.content, call.finish));
      result = spec ? validate(spec) : { errors: [parseError], warnings: [], stats: null };
    }

    if (spec) {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, `${JSON.stringify(spec, null, 2)}\n`);
      record.out = relative(ROOT, outPath);
    } else {
      const rawPath = join(HERE, "out", `${args.day}.${label}.gmi.raw.txt`);
      mkdirSync(dirname(rawPath), { recursive: true });
      writeFileSync(rawPath, call.content);
      record.raw = relative(ROOT, rawPath);
    }
    record.errors = result.errors;
    record.warnings = result.warnings.length;
    record.stats = result.stats;
  } catch (error) {
    record.failure = error.message;
    throw error;
  } finally {
    const usage = calls.reduce(
      (sum, c) => ({
        prompt_tokens: sum.prompt_tokens + (c.usage?.prompt_tokens ?? 0),
        completion_tokens: sum.completion_tokens + (c.usage?.completion_tokens ?? 0),
        reasoning_tokens: sum.reasoning_tokens + (c.usage?.completion_tokens_details?.reasoning_tokens ?? 0),
      }),
      { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0 },
    );
    if (calls.some((c) => c.usage?.estimated)) usage.estimated = true;
    const costs = calls.map((c) => callCost(prices, c.usage));
    const llmUsd = costs.some((c) => c == null) ? null : costs.reduce((a, b) => a + b, 0);
    const paintUsd = record.paintStep?.usd ?? 0;
    Object.assign(record, {
      calls: calls.length,
      latency_ms: calls.map((c) => c.ms),
      wall_ms: Date.now() - t0,
      usage,
      llm_usd: llmUsd,
      total_usd: llmUsd == null ? null : llmUsd + paintUsd,
    });
    appendFileSync(LEDGER, `${JSON.stringify(record)}\n`);
  }

  const { errors, warnings, stats } = record;
  console.log(
    `result: ${errors.length ? `${errors.length} errors remain` : "valid"}, ${warnings} warnings` +
      `${stats ? ` | ${formatStats(stats)}` : ""}`,
  );
  for (const e of errors) console.log(`  error: ${e}`);
  console.log(
    `total: LLM ${record.latency_ms.reduce((a, b) => a + b, 0)} ms over ${record.calls} call(s)` +
      `${record.paintStep ? `, paint ${record.paintStep.ms} ms` : ""}, wall ${record.wall_ms} ms` +
      `, tokens ${record.usage.estimated ? "~" : ""}${record.usage.prompt_tokens} in / ${record.usage.completion_tokens} out` +
      `, cost ${record.usage.estimated ? "~" : ""}${money(record.total_usd)}`,
  );
  console.log(`wrote ${record.out ?? record.raw}`);
  if (errors.length) process.exit(1);
}

main().catch((error) => {
  console.error(`gen.mjs: ${error.message}`);
  process.exit(1);
});
