import { vi } from "vitest";
import { models } from "./generation/models";

export const CHAT_URL = "https://api.gmi-serving.com/v1/chat/completions";
export const QUEUE_URL =
  "https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/requests";
export const MEDIA_URL = "https://storage.googleapis.com/gmi-test";

export const SCENE = {
  title: "First World Renders",
  caption: "We screamed when the first world finally rendered.",
  palette: ["#FFB347", "#2e4057", "#f6f1e9", "#e94f37"],
  imagePrompt:
    "A tiny office corner with one long table by the window, Red Bull cans, and a glowing laptop at sunset.",
};

type Step = "dreaming" | "painting" | "sculpting";
const STEPS: Step[] = ["dreaming", "painting", "sculpting"];

export type Outcome =
  | { result?: unknown }
  | { error: string }
  | { stuck: true }
  | { rejectSubmit: number; error?: string };

export type FakeRequest = {
  id: string;
  step: Step;
  model: string;
  input: Record<string, unknown>;
  outcome: Outcome;
  checks: number;
};

export function installFakeGmi() {
  const scripts: Record<Step, Outcome[]> = {
    dreaming: [],
    painting: [],
    sculpting: [],
  };
  const requests: FakeRequest[] = [];
  const rejectedSubmits: Step[] = [];
  const downloads: string[] = [];
  let onSubmit: ((step: Step) => Promise<void>) | undefined;

  async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}) {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href.startsWith(MEDIA_URL)) {
      downloads.push(url.pathname);
      return new Response(new Blob([url.pathname], { type: contentType(url.pathname) }));
    }
    if (url.href === CHAT_URL) {
      const { model, ...messages } = JSON.parse(String(init.body));
      return submit("dreaming", model, messages);
    }
    if (url.href === QUEUE_URL) {
      const { model, payload } = JSON.parse(String(init.body));
      const step = STEPS.find((candidate) => models[candidate].id === model);
      if (!step) {
        throw new Error(`Unexpected GMI model: ${model}`);
      }
      return submit(step, model, payload);
    }
    if (url.href.startsWith(`${QUEUE_URL}/`)) {
      const request = requests.find(
        (candidate) => candidate.id === url.pathname.split("/").pop(),
      );
      if (!request) {
        return json({ error: "request not found" }, 404);
      }
      request.checks += 1;
      return json(queueStatus(request));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }

  async function submit(step: Step, model: string, input: Record<string, unknown>) {
    await onSubmit?.(step);
    const outcome = scripts[step].shift() ?? {};
    if ("rejectSubmit" in outcome) {
      rejectedSubmits.push(step);
      return json(
        { error: outcome.error ?? "Upstream provider unavailable; please retry" },
        outcome.rejectSubmit,
      );
    }
    const request: FakeRequest = {
      id: `${step}-${requests.length + 1}`,
      step,
      model,
      input,
      outcome,
      checks: 0,
    };
    requests.push(request);
    if (step === "dreaming") {
      return "error" in outcome
        ? json({ error: { message: outcome.error } }, 400)
        : json(result(request));
    }
    const settled = !("stuck" in outcome) && step === "painting";
    return json({
      request_id: request.id,
      model,
      status: settled ? ("error" in outcome ? "failed" : "success") : "queued",
    });
  }

  function queueStatus(request: FakeRequest) {
    const base = { request_id: request.id, model: request.model, payload: request.input };
    if ("stuck" in request.outcome) {
      return {
        ...base,
        status: request.checks > 1 ? "processing" : "queued",
        outcome: null,
      };
    }
    if ("error" in request.outcome) {
      return {
        ...base,
        status: "failed",
        outcome: { error: request.outcome.error, error_source: "provider" },
      };
    }
    return { ...base, status: "success", outcome: result(request) };
  }

  vi.stubGlobal("fetch", vi.fn(fakeFetch));

  return {
    requests,
    rejectedSubmits,
    downloads,
    script(step: Step, ...outcomes: Outcome[]) {
      scripts[step].push(...outcomes);
    },
    submitted(step: Step) {
      return requests.filter((request) => request.step === step);
    },
    onSubmit(hook: (step: Step) => Promise<void>) {
      onSubmit = hook;
    },
  };
}

export type FakeGmi = ReturnType<typeof installFakeGmi>;

export function chatReply(content: string) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    choices: [
      { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
    ],
  };
}

function result(request: FakeRequest) {
  if ("result" in request.outcome && request.outcome.result !== undefined) {
    return request.outcome.result;
  }
  switch (request.step) {
    case "dreaming":
      return { ...chatReply(JSON.stringify(SCENE)), id: `chatcmpl-${request.id}` };
    case "painting":
      return {
        media_urls: [{ id: "0", url: `${MEDIA_URL}/${request.id}.jpg` }],
      };
    case "sculpting":
      return {
        media_urls: [
          { id: "0", type: "obj", url: `${MEDIA_URL}/${request.id}.zip` },
          { id: "1", type: "glb", url: `${MEDIA_URL}/${request.id}.glb` },
        ],
      };
  }
}

function contentType(path: string) {
  if (path.endsWith(".glb")) {
    return "model/gltf-binary";
  }
  return path.endsWith(".zip") ? "application/zip" : "image/jpeg";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
