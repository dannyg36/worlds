import { vi } from "vitest";
import { claudeText, type ClaudeRequest } from "./generation/anthropic";

export const OUTLINE = {
  title: "Cold Pizza at Nine",
  caption: "Cold pizza on the office floor, and the first world finally rendered.",
  palette: ["#FFB347", "#2e4057", "#f6f1e9"],
  time: "dusk",
  biome: "city",
  cast: [{ name: "me", skin: "#e0ac69", shirt: "#3b6ea5", hairStyle: "short" }],
  vignettes: [
    { title: "Office at nine", moment: "I unlock the office door at nine.", hero: false, size: "small", surface: "tile" },
    { title: "Pizza on the floor", moment: "I eat cold pizza on the floor.", hero: true, size: "large", surface: "carpet" },
    { title: "The first render", moment: "The first world renders on my laptop.", hero: false, size: "medium" },
    { title: "Walk home", moment: "I walk home under the street lamps.", hero: false, size: "medium", surface: "asphalt" },
  ],
};

export function vignetteObjects(index: number) {
  return [
    { type: "wall", at: [0, -1.5], length: 3, material: "brick" },
    { type: "table", id: `table-${index}`, at: [0, 0], size: [1.2, 0.8] },
    { type: "laptop", on: `table-${index}`, at: [0, 0], open: true },
    { type: "person", who: "me", pose: "sit", at: [0, 0.8] },
    { type: "custom", name: "red-bull", at: [0.6, 0.6], code: "return k.cyl(0.03, 0.03, 0.12, k.mat('#1e3a8a'));" },
  ];
}

type Reply = string | Error | Record<string, unknown>;
type Kind = "outline" | "vignette" | "repair";
export type ClaudeCall = ClaudeRequest & { kind: Kind; vignette?: number };

/** Answers mocked claudeText calls like the island writer's Claude would. */
export function installFakeClaude() {
  const calls: ClaudeCall[] = [];
  const scripts: Record<string, Reply[]> = {};
  let onCall: ((call: ClaudeCall) => Promise<void>) | undefined;
  vi.mocked(claudeText).mockImplementation(async (request) => {
    const match = /Write vignette (\d+) of/.exec(request.user);
    const vignette = match ? Number(match[1]) : undefined;
    const kind: Kind = request.user.includes("outline call")
      ? "outline"
      : request.user.includes("Your previous answer")
        ? "repair"
        : "vignette";
    const call = { ...request, kind, vignette };
    calls.push(call);
    await onCall?.(call);
    const reply =
      scripts[key(kind, vignette)]?.shift() ??
      (kind === "outline" ? OUTLINE : { objects: vignetteObjects(vignette ?? 0) });
    if (reply instanceof Error) {
      throw reply;
    }
    return typeof reply === "string" ? reply : JSON.stringify(reply);
  });
  return {
    calls,
    script(kind: Kind, vignette: number | undefined, ...replies: Reply[]) {
      (scripts[key(kind, vignette)] ??= []).push(...replies);
    },
    onCall(hook: (call: ClaudeCall) => Promise<void>) {
      onCall = hook;
    },
  };
}

export type FakeClaude = ReturnType<typeof installFakeClaude>;

function key(kind: Kind, vignette?: number) {
  return kind === "outline" ? kind : `${kind}-${vignette}`;
}
