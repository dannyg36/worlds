import { fal } from "./fal";
import { gmiChat, gmiQueue } from "./gmi";
import type { Provider } from "./provider";
import { parseScene, type Scene } from "./scene";
import {
  conceptImagePrompt,
  SCENE_WRITER_SYSTEM_PROMPT,
  sceneWriterPrompt,
} from "./sceneWriterPrompt";

export type Model<Input, Output> = {
  provider: Provider;
  id: string;
  input: (value: Input) => Record<string, unknown>;
  output: (result: unknown) => Output;
  pollMs: number;
  timeoutMs: number;
  maxTries: number;
  maxInFlight?: number;
};

type Models = {
  dreaming: Model<string, Scene>;
  painting: Model<Scene, string>;
  sculpting: Model<string, string>;
};

export const gmiModels: Models = {
  dreaming: {
    provider: gmiChat,
    id: "deepseek-ai/deepseek-v4.1-flash-1017",
    input: (transcript) => ({
      messages: [
        { role: "system", content: SCENE_WRITER_SYSTEM_PROMPT },
        { role: "user", content: sceneWriterPrompt(transcript) },
      ],
      temperature: 0.8,
      max_tokens: 1500,
      response_format: { type: "json_object" },
    }),
    output: (result) => parseScene(chatText(result)),
    pollMs: 1_000,
    timeoutMs: 45_000,
    maxTries: 3,
  },
  painting: {
    provider: gmiQueue,
    id: "seedream-4-0-250828",
    input: (scene) => ({
      prompt: conceptImagePrompt(scene),
      size: "1024x1024",
      max_images: 1,
      watermark: false,
    }),
    output: (result) => mediaUrl(result),
    pollMs: 1_000,
    timeoutMs: 60_000,
    maxTries: 3,
  },
  sculpting: {
    provider: gmiQueue,
    id: "hunyuan-3d-pro",
    input: (imageUrl) => ({
      image_url: imageUrl,
      generate_type: "Normal",
      enable_pbr: false,
      face_count: 40_000,
    }),
    output: (result) => mediaUrl(result, "glb"),
    pollMs: 3_000,
    timeoutMs: 10 * 60_000,
    maxTries: 2,
    maxInFlight: 1,
  },
};

export const falModels: Models = {
  dreaming: {
    provider: fal,
    id: "openrouter/router",
    input: (transcript) => ({
      model: "google/gemini-3.8-flash",
      system_prompt: SCENE_WRITER_SYSTEM_PROMPT,
      prompt: sceneWriterPrompt(transcript),
      temperature: 0.8,
      max_tokens: 800,
    }),
    output: (result) => parseScene(textField(result, "output")),
    pollMs: 750,
    timeoutMs: 45_000,
    maxTries: 3,
  },
  painting: {
    provider: fal,
    id: "fal-ai/z-image/turbo",
    input: (scene) => ({
      prompt: conceptImagePrompt(scene),
      image_size: "square_hd",
      num_inference_steps: 8,
      output_format: "jpeg",
    }),
    output: (result) => textField(field(result, "images", 0), "url"),
    pollMs: 750,
    timeoutMs: 60_000,
    maxTries: 2,
  },
  sculpting: {
    provider: fal,
    id: "fal-ai/trellis",
    input: (imageUrl) => ({
      image_url: imageUrl,
      texture_size: 1024,
      mesh_simplify: 0.95,
    }),
    output: (result) => textField(field(result, "model_mesh"), "url"),
    pollMs: 1_500,
    timeoutMs: 240_000,
    maxTries: 2,
    maxInFlight: 1,
  },
};

export const models: Models = gmiModels;

function chatText(result: unknown): string {
  return textField(field(result, "choices", 0, "message"), "content");
}

function mediaUrl(outcome: unknown, format?: "glb"): string {
  const media = field(outcome, "media_urls");
  const files = (Array.isArray(media) ? media : []).flatMap((entry) => {
    const url = field(entry, "url");
    return typeof url === "string" && url
      ? [{ url, type: String(field(entry, "type") ?? "") }]
      : [];
  });
  const file = format
    ? files.find(
        ({ url, type }) =>
          type.toLowerCase() === format ||
          new URL(url).pathname.toLowerCase().endsWith(`.${format}`),
      )
    : files[0];
  if (!file) {
    const wanted = format ? `${format.toUpperCase()} file` : "file";
    const found = files
      .map(({ url, type }) => type || new URL(url).pathname.split("/").pop())
      .join(", ");
    throw new Error(`The model returned no ${wanted}${found ? ` (got ${found})` : ""}.`);
  }
  return file.url;
}

function textField(value: unknown, key: string): string {
  const text = field(value, key);
  if (typeof text !== "string" || !text.trim()) {
    throw new Error(`The model returned no ${key}.`);
  }
  return text;
}

function field(value: unknown, ...path: (string | number)[]): unknown {
  return path.reduce<unknown>(
    (current, key) =>
      current && typeof current === "object"
        ? (current as Record<string | number, unknown>)[key]
        : undefined,
    value,
  );
}
