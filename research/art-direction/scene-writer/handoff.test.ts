import { writeScene, buildImagePrompt, GMI_CHAT, parseSceneSpec } from "./sceneWriter.ts";
import { readFileSync } from "node:fs";
const days = JSON.parse(readFileSync(process.argv[2], "utf8")).sample;
const apiKey = process.env.GMI_API_KEY ?? "";
for (const slug of ["mission-peak", "rainy-monday"]) {
  const r = await writeScene(days[slug], { apiKey, date: "2026-11-14" });
  console.log(slug, r.model, r.ms + "ms", r.spec.status, r.spec.title, "|", r.spec.caption, "| errors:", r.errors.length);
  console.log("  prompt chars", buildImagePrompt(r.spec).length);
}
const broken = { ...GMI_CHAT, primary: { ...GMI_CHAT.primary, model: "google/does-not-exist" } };
const f = await writeScene(days["hackathon"], { apiKey, provider: broken });
console.log("fallback", f.model, f.ms + "ms", f.spec.title, "| first error:", f.errors[0]?.slice(0, 120));
try { parseSceneSpec('{"status":"maybe"}'); } catch (e) { console.log("validator:", (e as Error).message); }
