import { vi } from "vitest";
import { models } from "./generation/models";

export const MEDIA_URL = "https://v3.fal.media/files";
const JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";

export const SCENE = {
  title: "First World Renders",
  caption: "We screamed when the first world finally rendered.",
  palette: ["#FFB347", "#2e4057", "#f6f1e9", "#e94f37"],
  imagePrompt:
    "A tiny office corner with one long table by the window, Red Bull cans, and a glowing laptop at sunset.",
};

type Step = keyof typeof models;

export type Outcome =
  | { result?: unknown }
  | { error: string }
  | { stuck: true }
  | { rejectSubmit: number };

export type FakeRequest = {
  id: string;
  step: Step;
  input: Record<string, unknown>;
  webhookUrl: string | null;
  outcome: Outcome;
  statusChecks: number;
  resultFetches: number;
  cancelled: boolean;
};

export function installFakeFal() {
  const scripts: Record<Step, Outcome[]> = {
    dreaming: [],
    painting: [],
    sculpting: [],
  };
  const requests: FakeRequest[] = [];
  const rejectedSubmits: Step[] = [];
  let jwks: object[] = [];

  async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}) {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === JWKS_URL) {
      return json({ keys: jwks });
    }
    if (url.href.startsWith(MEDIA_URL)) {
      const type = url.pathname.endsWith(".glb") ? "model/gltf-binary" : "image/jpeg";
      return new Response(new Blob([url.pathname], { type }));
    }
    if (url.host !== "queue.fal.run") {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    const match = url.pathname.match(/\/requests\/([^/]+)(\/status|\/cancel)?$/);
    if (!match) {
      const endpoint = url.pathname.slice(1);
      const step = (Object.keys(models) as Step[]).find(
        (candidate) => models[candidate].endpoint === endpoint,
      );
      if (!step) {
        throw new Error(`Unexpected fal endpoint: ${endpoint}`);
      }
      const outcome = scripts[step].shift() ?? {};
      if ("rejectSubmit" in outcome) {
        rejectedSubmits.push(step);
        return json({ detail: "Submit rejected" }, outcome.rejectSubmit);
      }
      const id = `${step}-${requests.length + 1}`;
      const base = `https://queue.fal.run/${endpoint.split("/").slice(0, 2).join("/")}/requests/${id}`;
      requests.push({
        id,
        step,
        input: JSON.parse(String(init.body)),
        webhookUrl: url.searchParams.get("fal_webhook"),
        outcome,
        statusChecks: 0,
        resultFetches: 0,
        cancelled: false,
      });
      return json({
        request_id: id,
        status_url: `${base}/status`,
        response_url: base,
        cancel_url: `${base}/cancel`,
        queue_position: 0,
      });
    }
    const request = requests.find((candidate) => candidate.id === match[1]);
    if (!request) {
      return json({ detail: "Not found" }, 404);
    }
    if (match[2] === "/cancel") {
      request.cancelled = true;
      return json({ status: "CANCELLATION_REQUESTED" }, 202);
    }
    if (match[2] === "/status") {
      request.statusChecks += 1;
      if ("stuck" in request.outcome) {
        return json({ status: "IN_PROGRESS", request_id: request.id, logs: [] });
      }
      return json({
        status: "COMPLETED",
        request_id: request.id,
        metrics: { inference_time: 1.25 },
        ...("error" in request.outcome ? { error: request.outcome.error } : {}),
      });
    }
    request.resultFetches += 1;
    if ("stuck" in request.outcome) {
      return json({ detail: "Request is still in progress" }, 400);
    }
    if ("error" in request.outcome) {
      return json({ detail: request.outcome.error }, 422);
    }
    return json(
      "result" in request.outcome && request.outcome.result !== undefined
        ? request.outcome.result
        : defaultResult(request),
    );
  }

  vi.stubGlobal("fetch", vi.fn(fakeFetch));

  return {
    requests,
    rejectedSubmits,
    script(step: Step, ...outcomes: Outcome[]) {
      scripts[step].push(...outcomes);
    },
    submitted(step: Step) {
      return requests.filter((request) => request.step === step);
    },
    setJwks(keys: object[]) {
      jwks = keys;
    },
  };
}

export type FakeFal = ReturnType<typeof installFakeFal>;

export function defaultResult(request: Pick<FakeRequest, "id" | "step">) {
  switch (request.step) {
    case "dreaming":
      return { output: `Here you go:\n\`\`\`json\n${JSON.stringify(SCENE)}\n\`\`\`` };
    case "painting":
      return {
        images: [{ url: `${MEDIA_URL}/${request.id}.jpg`, content_type: "image/jpeg" }],
      };
    case "sculpting":
      return {
        model_mesh: { url: `${MEDIA_URL}/${request.id}.glb` },
        model_glb: { url: `${MEDIA_URL}/${request.id}.glb` },
      };
  }
}

export async function webhookSigner() {
  const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", keys.publicKey),
  );
  return {
    jwk: { kty: "OKP", crv: "Ed25519", x: toBase64Url(publicKey) },
    async sign(
      delivery: Record<string, unknown>,
      { timestamp = Math.floor(Date.now() / 1000) } = {},
    ): Promise<RequestInit> {
      const body = JSON.stringify(delivery);
      const bodyHash = toHex(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
      );
      const requestId = String(delivery.request_id);
      const message = [requestId, "fal-user", String(timestamp), bodyHash].join("\n");
      const signature = await crypto.subtle.sign(
        { name: "Ed25519" },
        keys.privateKey,
        new TextEncoder().encode(message),
      );
      return {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-fal-webhook-request-id": requestId,
          "x-fal-webhook-user-id": "fal-user",
          "x-fal-webhook-timestamp": String(timestamp),
          "x-fal-webhook-signature": toHex(signature),
        },
        body,
      };
    },
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
