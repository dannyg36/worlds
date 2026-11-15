import Anthropic from "@anthropic-ai/sdk";
import { env } from "../_generated/server";
import { ProviderError } from "./provider";

export const CLAUDE_MODEL = "claude-opus-5-5";
const MAX_TOKENS = 16_000;

export type ImageType = Anthropic.Beta.BetaBase64ImageSource["media_type"];
/** A base64 image, sent after its label and before the user text. */
export type ClaudeImage = { label: string; mediaType: ImageType; data: string };

export type ClaudeRequest = {
  model: string;
  system: string;
  user: string;
  images?: ClaudeImage[];
  effort: "low" | "medium";
};

/**
 * One streamed Claude call that returns the reply's text. The system prompt is
 * cached, refusals fall back server-side, and a refusal or a reply cut off at
 * max_tokens throws instead of returning partial text.
 */
export async function claudeText(
  { model, system, user, images = [], effort }: ClaudeRequest,
  { timeoutMs, signal }: { timeoutMs: number; signal?: AbortSignal },
): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new ProviderError(
      "ANTHROPIC_API_KEY is not set on this Convex deployment.",
      401,
    );
  }
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    timeout: timeoutMs,
    maxRetries: 2,
  });
  let message: Anthropic.Beta.BetaMessage;
  try {
    message = await client.beta.messages
      .stream(
        {
          model,
          max_tokens: MAX_TOKENS,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort },
          system: [
            { type: "text", text: system, cache_control: { type: "ephemeral" } },
          ],
          messages: [
            {
              role: "user",
              content: images.length
                ? [
                    ...images.flatMap(
                      ({ label, mediaType, data }): Anthropic.Beta.BetaContentBlockParam[] => [
                        { type: "text", text: label },
                        { type: "image", source: { type: "base64", media_type: mediaType, data } },
                      ],
                    ),
                    { type: "text", text: user },
                  ]
                : user,
            },
          ],
        },
        { signal },
      )
      .finalMessage();
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      throw new ProviderError(
        `Claude ${error.status ?? "error"}: ${error.message}`.slice(0, 300),
        error.status,
      );
    }
    throw error;
  }
  if (message.stop_reason === "refusal") {
    throw new ProviderError(
      `Claude declined to write this (${message.stop_details?.category ?? "no category"}).`,
    );
  }
  if (message.stop_reason === "max_tokens") {
    throw new ProviderError(`Claude's reply ran past ${MAX_TOKENS} tokens.`);
  }
  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  if (!text.trim()) {
    throw new ProviderError("Claude returned no text.");
  }
  return text;
}
