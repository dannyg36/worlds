import { parseScene, type Scene } from "./scene";
import {
  conceptImagePrompt,
  SCENE_WRITER_SYSTEM_PROMPT,
  sceneWriterPrompt,
} from "./sceneWriterPrompt";

export type FalModel<Input, Output> = {
  endpoint: string;
  input: (value: Input) => Record<string, unknown>;
  output: (result: unknown) => Output;
  firstPollMs: number;
  pollMs: number;
  timeoutMs: number;
  maxTries: number;
};

const geminiFlashSceneWriter: FalModel<string, Scene> = {
  endpoint: "openrouter/router",
  input: (transcript) => ({
    model: "google/gemini-3.8-flash",
    system_prompt: SCENE_WRITER_SYSTEM_PROMPT,
    prompt: sceneWriterPrompt(transcript),
    temperature: 0.8,
    max_tokens: 800,
  }),
  output: (result) => parseScene(textOutput(result)),
  firstPollMs: 1500,
  pollMs: 750,
  timeoutMs: 45_000,
  maxTries: 3,
};

const zImageTurbo: FalModel<Scene, string> = {
  endpoint: "fal-ai/z-image/turbo",
  input: (scene) => ({
    prompt: conceptImagePrompt(scene),
    image_size: "square_hd",
    num_inference_steps: 8,
    output_format: "jpeg",
  }),
  output: (result) => fileUrl(field(result, "images", 0)),
  firstPollMs: 1500,
  pollMs: 750,
  timeoutMs: 60_000,
  maxTries: 2,
};

const trellis: FalModel<string, string> = {
  endpoint: "fal-ai/trellis",
  input: (imageUrl) => ({
    image_url: imageUrl,
    texture_size: 1024,
    mesh_simplify: 0.95,
  }),
  output: (result) => fileUrl(field(result, "model_mesh")),
  firstPollMs: 8000,
  pollMs: 1500,
  timeoutMs: 240_000,
  maxTries: 2,
};

export const models = {
  dreaming: geminiFlashSceneWriter,
  painting: zImageTurbo,
  sculpting: trellis,
};

function textOutput(result: unknown): string {
  const output = field(result, "output");
  if (typeof output !== "string" || !output.trim()) {
    const error = field(result, "error");
    throw new Error(
      typeof error === "string" ? error : "The scene writer returned no text.",
    );
  }
  return output;
}

function fileUrl(file: unknown): string {
  const url = field(file, "url");
  if (typeof url !== "string" || !url) {
    throw new Error("fal returned no file URL.");
  }
  return url;
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
