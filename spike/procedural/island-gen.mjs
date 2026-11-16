#!/usr/bin/env node
// Writes an island spec (ISLAND.md) for one sample day in two-call mode: one outline call, then one call per
// vignette in parallel, then one repair call for each vignette that fails validation.
// Usage:
//   node spike/procedural/island-gen.mjs --day <slug> [--provider anthropic|gmi] [--model <id>]
//     [--effort low|medium|high] [--outline-effort low|medium|high] [--out <path>]
// --effort is for the vignette and repair calls (default low), --outline-effort for the outline (default medium).
// Both are Anthropic-only; the GMI path reuses gen.mjs's chat call as is (reasoning_effort low).
// Keys come from the environment: ANTHROPIC_API_KEY or GMI_API_KEY. Never print, log or commit them.

import Anthropic from "@anthropic-ai/sdk";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Agent, setGlobalDispatcher } from "undici";
import { ProviderError, callCost, chat as gmiChat, llmPrices, money, parseSpec, readTranscript } from "./gen.mjs";
import { PLOT_RADIUS, formatStats, validate, validateVignette } from "./validate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const ISLAND = readFileSync(join(HERE, "ISLAND.md"), "utf8");
const LEDGER = join(HERE, "island-gen-ledger.jsonl");
const DEFAULT_MODEL = { anthropic: "claude-opus-5-5", gmi: "google/gemini-3.8-flash" };
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const MAX_TOKENS = 16_000;
// USD per token. Cache writes (5 minute TTL) bill at 1.25x input.
const CLAUDE_PRICES = { "claude-opus-5-5": { input: 4e-6, output: 20e-6, cacheWrite: 5e-6, cacheRead: 0.2e-6 } };

// Node 26's fetch reuses the outline call's HTTP/2 connection and runs the "parallel" vignette calls on it one at a
// time (each started streaming as the previous one finished, on both providers). HTTP/1.1 opens a connection each.
setGlobalDispatcher(new Agent({ allowH2: false }));

function usage(message) {
  if (message) console.error(`island-gen.mjs: ${message}`);
  console.error(
    "usage: node spike/procedural/island-gen.mjs --day <slug> [--provider anthropic|gmi] [--model <id>] [--effort low|medium|high] [--outline-effort low|medium|high] [--out <path>]",
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
        provider: { type: "string", default: "anthropic" },
        model: { type: "string" },
        effort: { type: "string", default: "low" },
        "outline-effort": { type: "string", default: "medium" },
        out: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    }));
  } catch (error) {
    usage(error.message);
  }
  if (values.help) usage();
  if (!values.day) usage("--day is required");
  if (!(values.provider in DEFAULT_MODEL)) usage("--provider must be anthropic or gmi");
  for (const key of ["effort", "outline-effort"]) {
    if (!EFFORTS.includes(values[key])) usage(`--${key} must be one of ${EFFORTS.join(", ")}`);
  }
  return {
    day: values.day,
    provider: values.provider,
    model: values.model ?? DEFAULT_MODEL[values.provider],
    effort: values.effort,
    outlineEffort: values["outline-effort"],
    out: values.out ? resolve(values.out) : join(HERE, "scenes", "islands", `${values.day}.${values.provider}.json`),
  };
}

// ---------- providers ----------
// Each returns { ms, usage: { input, output, cacheRead, cacheWrite }, usd, finish, content, assistant }.
// `finish` is "length" when the reply was cut off; `assistant` is what to send back for a repair turn.

let anthropic;

async function claude({ model, effort, messages }) {
  anthropic ??= new Anthropic();
  const t0 = Date.now();
  let message;
  let ttft; // first content block (thinking starts it); a late one means the request queued
  try {
    const stream = anthropic.beta.messages.stream({
      model,
      max_tokens: MAX_TOKENS,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort },
      system: [{ type: "text", text: ISLAND, cache_control: { type: "ephemeral" } }],
      messages,
    });
    stream.on("streamEvent", (event) => {
      if (ttft === undefined && event.type === "content_block_start") ttft = Date.now() - t0;
    });
    message = await stream.finalMessage();
  } catch (error) {
    if (error instanceof Anthropic.APIError) throw new ProviderError(`Anthropic ${error.status ?? "error"}: ${error.message}`);
    throw error;
  }
  const u = message.usage;
  const tokens = {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
  const p = CLAUDE_PRICES[model];
  const fellBack = message.model !== model || (u.iterations ?? []).some((entry) => entry.type === "fallback_message");
  const call = {
    ms: Date.now() - t0,
    ttft,
    usage: tokens,
    // A fallback turn bills at the fallback model's rates; this prices everything at the requested model's.
    usd: p
      ? tokens.input * p.input + tokens.output * p.output + tokens.cacheWrite * p.cacheWrite + tokens.cacheRead * p.cacheRead
      : null,
    finish: message.stop_reason === "max_tokens" ? "length" : message.stop_reason,
    servedBy: fellBack ? message.model : undefined,
    content: message.content.filter((block) => block.type === "text").map((block) => block.text).join(""),
    assistant: message.content,
  };
  if (message.stop_reason === "refusal") {
    const d = message.stop_details;
    call.error = `refused${d?.category ? ` (${d.category})` : ""}${d?.explanation ? `: ${d.explanation}` : ""}`;
  }
  return call;
}

async function gmi({ model, messages }) {
  const call = await gmiChat(model, [{ role: "system", content: ISLAND }, ...messages]);
  const u = call.usage ?? {};
  return {
    ms: call.ms,
    usage: {
      input: u.prompt_tokens,
      output: u.completion_tokens,
      cacheRead: u.prompt_tokens_details?.cached_tokens ?? 0,
      cacheWrite: 0,
      ...(u.estimated && { estimated: true }),
    },
    usd: callCost(llmPrices(model), call.usage),
    finish: call.finish,
    content: call.content,
    assistant: call.content,
  };
}

// ---------- prompts ----------

const note = (transcript) => `Voice note:\n"""\n${transcript}\n"""`;

const outlinePrompt = (transcript) =>
  `${note(transcript)}\n\nThis is the outline call of two-call mode. Write the top level of this day's island, with \`vignettes\` holding only title, moment, hero, size and surface (no objects). Output one JSON object, nothing else.`;

function vignettePrompt(transcript, outline, i) {
  const v = outline.vignettes[i];
  const radius = PLOT_RADIUS[v.size];
  const bound = radius ? `plot radius ${radius} m, so |x| and |z| at most ${(radius - 0.2).toFixed(1)}` : "";
  return `${note(transcript)}

Island outline:
${JSON.stringify(outline, null, 2)}

This is a vignette call of two-call mode. Write vignette ${i + 1} of ${outline.vignettes.length}, "${v.title}"${v.hero ? " (the hero)" : ""}: ${v.moment}
It is ${v.size}${bound ? ` (${bound})` : ""}. Give cast members their cast name in \`who\`. Return {"objects": [...]} for this vignette only: one JSON object, nothing else.`;
}

// ---------- run ----------

function totals(calls) {
  const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const c of calls) for (const key of Object.keys(sum)) sum[key] += c.usage?.[key] ?? 0;
  if (calls.some((c) => c.usage?.estimated)) sum.estimated = true;
  return sum;
}

function vignetteObjects(call) {
  const { spec, parseError } = parseSpec(call.content, call.finish);
  if (parseError) return { error: parseError };
  const objects = Array.isArray(spec) ? spec : spec?.objects;
  return Array.isArray(objects) ? { objects } : { error: "reply has no objects array" };
}

async function main() {
  const args = parseCli(process.argv.slice(2));
  const keyName = args.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "GMI_API_KEY";
  if (!process.env[keyName]) {
    console.error(`island-gen.mjs: ${keyName} is not set. Export it (never commit or print it) and rerun.`);
    process.exit(1);
  }
  const transcript = readTranscript(args.day);
  const send = args.provider === "anthropic" ? claude : gmi;
  const calls = [];

  async function ask(step, effort, messages) {
    const call = await send({ model: args.model, effort, messages });
    calls.push({ step, ...call });
    const u = call.usage;
    console.log(
      `  ${step}: ${call.ms} ms${call.ttft !== undefined ? ` (first token ${call.ttft} ms)` : ""}, ${u.estimated ? "~" : ""}${u.input} in (cache read ${u.cacheRead}, write ${u.cacheWrite}) / ${u.output} out` +
        `, ${call.finish}${call.servedBy ? `, served by ${call.servedBy}` : ""}, ${money(call.usd)}`,
    );
    if (call.error) throw new ProviderError(`${step} ${call.error}`);
    return call;
  }

  const t0 = Date.now();
  const record = {
    ts: new Date().toISOString(),
    day: args.day,
    provider: args.provider,
    model: args.model,
    effort: args.provider === "anthropic" ? { outline: args.outlineEffort, vignette: args.effort } : "gmi reasoning_effort low",
  };
  let result;
  try {
    console.log(`model: ${args.model} via ${args.provider}`);

    // 1. Outline.
    const outlineMessages = [{ role: "user", content: outlinePrompt(transcript) }];
    const outlineCall = await ask("outline", args.outlineEffort, outlineMessages);
    record.outline_ms = Date.now() - t0;
    const { spec: outline, parseError } = parseSpec(outlineCall.content, outlineCall.finish);
    if (!outline || !Array.isArray(outline.vignettes) || !outline.vignettes.length) {
      const rawPath = join(HERE, "out", `${args.day}.${args.provider}.outline.raw.txt`);
      mkdirSync(dirname(rawPath), { recursive: true });
      writeFileSync(rawPath, outlineCall.content);
      throw new ProviderError(`outline is unusable (${parseError ?? "no vignettes array"}); raw reply in ${relative(ROOT, rawPath)}`);
    }
    outline.vignettes = outline.vignettes.map(({ objects, ...v }) => v);
    const castNames = new Set((outline.cast ?? []).map((c) => c?.name).filter((name) => typeof name === "string"));
    console.log(`outline: "${outline.title}", ${outline.vignettes.length} vignettes, cast ${[...castNames].join(", ")}`);

    // 2. Vignettes, all in parallel.
    const t1 = Date.now();
    const threads = outline.vignettes.map((_, i) => [{ role: "user", content: vignettePrompt(transcript, outline, i) }]);
    const replies = await Promise.all(threads.map((messages, i) => ask(`vignette ${i + 1}`, args.effort, messages)));
    record.vignettes_ms = Date.now() - t1;
    record.slowest_vignette_ms = Math.max(...replies.map((c) => c.ms));

    const check = (i, call) => {
      const { objects, error } = vignetteObjects(call);
      const vignette = { ...outline.vignettes[i], objects: objects ?? [] };
      return { vignette, errors: error ? [error] : validateVignette(vignette, i, castNames).errors };
    };
    const checked = replies.map((call, i) => check(i, call));

    // 3. One repair call per failing vignette, also in parallel.
    const failing = checked.map((c, i) => (c.errors.length ? i : -1)).filter((i) => i >= 0);
    record.repaired = failing.map((i) => i + 1);
    if (failing.length) {
      console.log(`repairing vignette${failing.length > 1 ? "s" : ""} ${record.repaired.join(", ")}:`);
      for (const i of failing) for (const e of checked[i].errors) console.log(`    ${i + 1}: ${e}`);
      const t2 = Date.now();
      await Promise.all(
        failing.map(async (i) => {
          const messages = [
            ...threads[i],
            { role: "assistant", content: replies[i].assistant },
            {
              role: "user",
              content: `That vignette has these errors:\n${checked[i].errors.map((e) => `- ${e}`).join("\n")}\n\nFix them and output the complete corrected {"objects": [...]} JSON object, nothing else.`,
            },
          ];
          checked[i] = check(i, await ask(`repair ${i + 1}`, args.effort, messages));
        }),
      );
      record.repair_ms = Date.now() - t2;
    }

    // 4. Assemble, validate, write.
    const island = { ...outline, vignettes: checked.map((c) => c.vignette) };
    result = validate(island);
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(island, null, 2)}\n`);
    record.out = relative(ROOT, args.out);
    record.errors = result.errors;
    record.warnings = result.warnings;
    record.stats = result.stats;
  } catch (error) {
    record.failure = error.message;
    throw error;
  } finally {
    const usd = calls.some((c) => c.usd == null) ? null : calls.reduce((sum, c) => sum + c.usd, 0);
    Object.assign(record, {
      calls: calls.map(({ step, ms, ttft, usage, usd, finish, servedBy }) => ({ step, ms, ttft, usage, usd, finish, servedBy })),
      wall_ms: Date.now() - t0,
      usage: totals(calls),
      usd,
    });
    appendFileSync(LEDGER, `${JSON.stringify(record)}\n`);
  }

  const { errors, warnings, stats } = result;
  console.log(`result: ${errors.length ? `${errors.length} errors remain` : "valid"}, ${warnings.length} warnings | ${formatStats(stats)}`);
  for (const e of errors) console.log(`  error: ${e}`);
  for (const w of warnings) console.log(`  warning: ${w}`);
  const u = record.usage;
  console.log(
    `time: outline ${record.outline_ms} ms, vignettes ${record.vignettes_ms} ms (slowest call ${record.slowest_vignette_ms} ms)` +
      `${record.repair_ms ? `, repair ${record.repair_ms} ms` : ""}, total ${record.wall_ms} ms`,
  );
  console.log(
    `tokens: ${u.estimated ? "~" : ""}${u.input} in + ${u.cacheRead} cache read + ${u.cacheWrite} cache write / ${u.output} out` +
      ` over ${calls.length} calls, cost ${u.estimated ? "~" : ""}${money(record.usd)}`,
  );
  console.log(`wrote ${record.out}`);
  if (errors.length) process.exit(1);
}

main().catch((error) => {
  console.error(`island-gen.mjs: ${error.message}`);
  process.exit(1);
});
