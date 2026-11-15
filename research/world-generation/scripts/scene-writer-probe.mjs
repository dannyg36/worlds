import { readFileSync } from "node:fs";
import { call, show, LLM } from "./gmi.mjs";
import { SCENE_WRITER_SYSTEM_PROMPT, sceneWriterPrompt } from "/workspace/worlds/convex/generation/sceneWriterPrompt.ts";
import { parseScene } from "/workspace/worlds/convex/generation/scene.ts";
const days = readFileSync("/home/user/.capy/drive/captain-gurnoor-sandu/handoffs/sample-days.md", "utf8").split(/^## /m).slice(1).map((b) => { const [slug, ...rest] = b.trim().split("\n"); return { slug: slug.trim(), transcript: rest.join(" ").trim() }; });
const extra = process.env.EXTRA ? JSON.parse(process.env.EXTRA) : {};
const rounds = Number(process.env.ROUNDS ?? 1);
const rows = [];
for (let round = 0; round < rounds; round++) {
  rows.push(...await Promise.all(days.map(async (day) => {
    const r = await call("POST", `${LLM}/chat/completions`, {
      model: process.env.MODEL ?? "deepseek-ai/deepseek-v4.1-flash-1017",
      messages: [{ role: "system", content: SCENE_WRITER_SYSTEM_PROMPT }, { role: "user", content: sceneWriterPrompt(day.transcript) }],
      temperature: 0.8, max_tokens: 1500, response_format: { type: "json_object" }, ...extra,
    }, 60000);
    const choice = r.json?.choices?.[0];
    let ok = false, err;
    try { parseScene(choice?.message?.content ?? ""); ok = true; } catch (e) { err = e.message; }
    return { slug: day.slug, status: r.status, ms: r.ms, finish: choice?.finish_reason, content: (choice?.message?.content ?? "").length, reasoningField: (choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? "").length, reasoningTokens: r.json?.usage?.completion_tokens_details?.reasoning_tokens, completion: r.json?.usage?.completion_tokens, ok, err, error: r.status !== 200 ? (r.json ?? r.text) : undefined };
  })));
}
const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
show({ extra, n: rows.length, failures: rows.filter((r) => !r.ok), p50: ms[Math.floor(ms.length / 2)], max: ms.at(-1), min: ms[0], rows: rows.map((r) => `${r.slug} ${r.ms}ms ${r.finish} content=${r.content} reasoning=${r.reasoningTokens} ok=${r.ok}`) });
