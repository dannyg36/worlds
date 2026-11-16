import { describe, expect, test } from "vitest";
import { claudeIslandWriter, falModels, gmiModels, gmiSceneWriter } from "./models";

const SCENE = {
  title: "Ramen and Rain",
  caption: "Rain on the skylight and the best ramen in town.",
  palette: ["#334155", "#F59E0B", "#e2e8f0"],
  imagePrompt: "A tiny ramen shop on a rainy street corner.",
};

describe("GMI models", () => {
  test("the island writer is Claude, and 3D sculpting is off", () => {
    expect(gmiModels.dreaming).toBe(claudeIslandWriter);
    expect(claudeIslandWriter.id).toBe("claude-opus-5-5");
    expect(gmiModels.sculpt).toBe(false);
    expect(gmiModels.painting.input({ ...SCENE, imagePrompt: "an island" })).toMatchObject({
      prompt: "an island",
    });
  });

  test("the legacy scene writer reads the chat reply", () => {
    const reply = {
      choices: [{ message: { role: "assistant", content: JSON.stringify(SCENE) } }],
    };
    expect(gmiSceneWriter.output(reply)).toEqual({
      scene: {
        ...SCENE,
        palette: ["#334155", "#f59e0b", "#e2e8f0"],
        imagePrompt: expect.stringContaining(SCENE.imagePrompt),
      },
    });
    expect(() => gmiSceneWriter.output({ choices: [] })).toThrow(
      "The model returned no content.",
    );
  });

  test("the concept image is the first file GMI returns", () => {
    expect(
      gmiModels.painting.output({
        media_urls: [{ id: "0", url: "https://storage.googleapis.com/x/source_image.jpg" }],
      }),
    ).toBe("https://storage.googleapis.com/x/source_image.jpg");
    expect(() => gmiModels.painting.output({ media_urls: [] })).toThrow(
      "The model returned no file.",
    );
  });

  test("the 3D step keeps the GLB and says what came back instead", () => {
    const glb = "https://storage.googleapis.com/x/model.glb";
    expect(
      gmiModels.sculpting.output({
        media_urls: [
          { id: "0", type: "obj", url: "https://storage.googleapis.com/x/model.zip" },
          { id: "1", url: glb },
        ],
      }),
    ).toBe(glb);
    expect(
      gmiModels.sculpting.output({
        media_urls: [{ id: "0", type: "GLB", url: "https://storage.googleapis.com/x/0" }],
      }),
    ).toBe("https://storage.googleapis.com/x/0");
    expect(() =>
      gmiModels.sculpting.output({
        media_urls: [
          { id: "0", type: "obj", url: "https://storage.googleapis.com/x/model.zip" },
          { id: "1", url: "https://storage.googleapis.com/x/preview.png" },
        ],
      }),
    ).toThrow("The model returned no GLB file (got obj, preview.png).");
  });

  test("hunyuan-3d-pro is asked for 40,000 faces from the concept image", () => {
    expect(gmiModels.sculpting.input("https://storage.googleapis.com/x/a.jpg")).toEqual({
      image_url: "https://storage.googleapis.com/x/a.jpg",
      generate_type: "Normal",
      enable_pbr: false,
      face_count: 40_000,
    });
    expect(gmiModels.sculpting.maxInFlight).toBe(1);
  });
});

describe("fal models", () => {
  test("read fal's response shapes", () => {
    expect(falModels.dreaming.output({ output: JSON.stringify(SCENE) }).scene.title).toBe(
      SCENE.title,
    );
    expect(
      falModels.painting.output({ images: [{ url: "https://v3.fal.media/files/a.jpg" }] }),
    ).toBe("https://v3.fal.media/files/a.jpg");
    expect(
      falModels.sculpting.output({ model_mesh: { url: "https://v3.fal.media/files/a.glb" } }),
    ).toBe("https://v3.fal.media/files/a.glb");
  });
});
