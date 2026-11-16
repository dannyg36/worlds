import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { claudeText } from "./anthropic";

type Call = { url: string; headers: Headers; body: Record<string, unknown> };

function sse(text: string, stopReason: string) {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 5 },
    },
    { type: "message_stop" },
  ];
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function stubClaude(text: string, stopReason = "end_turn") {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({
        url: String(input),
        headers: new Headers(init.headers),
        body: JSON.parse(String(init.body)),
      });
      return sse(text, stopReason);
    }),
  );
  return calls;
}

const REQUEST = {
  model: "claude-opus-5-5",
  system: "You write islands.",
  user: "Write vignette 1 of 4.",
  effort: "low" as const,
};

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("claudeText", () => {
  test("streams one cached, fallback-enabled request and returns the text", async () => {
    const calls = stubClaude('{"objects": []}');

    expect(await claudeText(REQUEST, { timeoutMs: 60_000 })).toBe('{"objects": []}');
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toContain("https://api.anthropic.com/v1/messages");
    expect(call.headers.get("authorization")).toBe("Bearer test-key");
    expect(call.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(call.body).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 16_000,
      stream: true,
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [
        { type: "text", text: "You write islands.", cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: "Write vignette 1 of 4." }],
    });
  });

  test("sends each image after its label and before the prompt", async () => {
    const calls = stubClaude("{}");

    await claudeText(
      { ...REQUEST, images: [{ label: "Photo 1", mediaType: "image/jpeg", data: "/9j/4A==" }] },
      { timeoutMs: 60_000 },
    );
    expect(calls[0].body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Photo 1" },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/4A==" } },
          { type: "text", text: "Write vignette 1 of 4." },
        ],
      },
    ]);
  });

  test("throws on a refusal or a reply cut off at max_tokens", async () => {
    stubClaude("I can't", "refusal");
    await expect(claudeText(REQUEST, { timeoutMs: 60_000 })).rejects.toThrow(
      "Claude declined to write this",
    );
    stubClaude('{"objects": [', "max_tokens");
    await expect(claudeText(REQUEST, { timeoutMs: 60_000 })).rejects.toThrow(
      "Claude's reply ran past 16000 tokens.",
    );
  });

  test("fails as unauthorized without ANTHROPIC_API_KEY", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const calls = stubClaude("{}");
    await expect(claudeText(REQUEST, { timeoutMs: 60_000 })).rejects.toMatchObject({
      message: "ANTHROPIC_API_KEY is not set on this Convex deployment.",
      status: 401,
    });
    expect(calls).toHaveLength(0);
  });
});
