import type { Scene } from "./scene";

export const SCENE_WRITER_SYSTEM_PROMPT = `You turn a short voice note about someone's day into the design for a tiny 3D diorama of that day.

Reply with one JSON object and nothing else:
{"title": "...", "caption": "...", "palette": ["#rrggbb", "#rrggbb", "#rrggbb", "#rrggbb"], "imagePrompt": "..."}

title: 2 to 5 words that name the day like a postcard would. No dates, emoji, or quotation marks.
caption: one warm, specific sentence under 90 characters, in the speaker's own voice.
palette: 3 to 5 hex colors that carry the day's mood and light, the dominant color first.
imagePrompt: under 90 words describing one miniature diorama of the day for an image model. Choose the single place that best holds the day and 3 to 5 concrete objects or moments from the note, all standing on one round base. Show the time of day and the weather through light and color. Any people are small stylized figures without detailed faces. No text, signs, or lettering. Don't describe the camera, background, art style, or rendering; those are added separately.`;

export function sceneWriterPrompt(transcript: string): string {
  return `Voice note:\n"""\n${transcript}\n"""`;
}

const CONCEPT_IMAGE_STYLE =
  "Isometric three-quarter view of a single miniature diorama on a round base, centered and fully in frame with empty space around it, plain white background, soft even studio light, stylized hand-painted clay toy look, chunky simple shapes, no text or letters.";

export function conceptImagePrompt(scene: Scene): string {
  return `${scene.imagePrompt}\n\n${CONCEPT_IMAGE_STYLE}`;
}
