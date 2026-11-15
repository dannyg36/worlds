import { CLAUDE_MODEL } from "./anthropic";
import { fal } from "./fal";
import { gmiChat, gmiQueue } from "./gmi";
import { claudeIsland, islandScene, type Island } from "./island";
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

/** island is the island spec as a JSON string; the legacy scene writer has none. */
export type Dream = { scene: Scene; island?: string };

type Models = {
  dreaming: Model<{ transcript: string; cast: string }, Dream>;
  painting: Model<Scene, string>;
  sculpting: Model<string, string>;
  /** Run the image-to-3D step after painting. Off while the island renderer replaces it. */
  sculpt: boolean;
};

export const claudeIslandWriter: Models["dreaming"] = {
  provider: claudeIsland,
  id: CLAUDE_MODEL,
  input: ({ transcript, cast }) => ({ transcript, cast }),
  output: (result) => {
    if (typeof result !== "string") {
      throw new Error("The island writer returned no island.");
    }
    return { scene: islandScene(JSON.parse(result) as Island), island: result };
  },
  pollMs: 1_000,
  // One outline call, parallel vignette calls, and maybe a repair round, all
  // inside one action; Convex stops actions at 10 minutes.
  timeoutMs: 8 * 60_000,
  maxTries: 2,
};

/** The pre-island scene writer, for a pipeline that sculpts a 3D model instead. */
export const gmiSceneWriter: Models["dreaming"] = {
  provider: gmiChat,
  id: "google/gemini-3.8-flash",
  input: ({ transcript, cast }) => ({
    messages: [
      { role: "system", content: SCENE_WRITER_SYSTEM_PROMPT },
      { role: "user", content: sceneWriterPrompt(transcript, cast) },
    ],
    temperature: 0.8,
    max_tokens: 1500,
    reasoning_effort: "low",
    response_format: { type: "json_object" },
  }),
  output: (result) => sceneWriterDream(chatText(result)),
  pollMs: 1_000,
  timeoutMs: 45_000,
  maxTries: 3,
};

export const gmiModels: Models = {
  dreaming: claudeIslandWriter,
  painting: {
    provider: gmiQueue,
    id: "seedream-4-0-250828",
    input: (scene) => ({
      prompt: scene.imagePrompt,
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
  sculpt: false,
};

export const falModels: Models = {
  dreaming: {
    provider: fal,
    id: "openrouter/router",
    input: ({ transcript, cast }) => ({
      model: "google/gemini-3.8-flash",
      system_prompt: SCENE_WRITER_SYSTEM_PROMPT,
      prompt: sceneWriterPrompt(transcript, cast),
      temperature: 0.8,
      max_tokens: 800,
    }),
    output: (result) => sceneWriterDream(textField(result, "output")),
    pollMs: 750,
    timeoutMs: 45_000,
    maxTries: 3,
  },
  painting: {
    provider: fal,
    id: "fal-ai/z-image/turbo",
    input: (scene) => ({
      prompt: scene.imagePrompt,
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
  sculpt: true,
};

export const models: Models = gmiModels;

function sceneWriterDream(text: string): Dream {
  const scene = parseScene(text);
  return { scene: { ...scene, imagePrompt: conceptImagePrompt(scene) } };
}

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
