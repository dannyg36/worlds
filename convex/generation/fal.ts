import { env } from "../_generated/server";
import {
  asRecord,
  ProviderError,
  requestJson,
  withRetries,
  type JsonRequest,
  type Provider,
} from "./provider";

const QUEUE_URL = "https://queue.fal.run";
const CHECK_TIMEOUT_MS = 30_000;

export const fal: Provider = {
  name: "fal",
  submit: async (model, input, timeoutMs) => {
    const body = asRecord(
      await falFetch(
        `${QUEUE_URL}/${model}`,
        {
          method: "POST",
          headers: {
            "X-Fal-Request-Start-Timeout": String(Math.ceil(timeoutMs / 1000)),
          },
          body: JSON.stringify(input),
        },
      ),
    );
    if (typeof body.request_id !== "string") {
      throw new ProviderError("fal's queue did not return a request id.");
    }
    return { state: "pending", requestId: body.request_id };
  },
  check: async (model, requestId) => {
    const requestUrl = falRequestUrl(model, requestId);
    const status = asRecord(await falFetch(`${requestUrl}/status`));
    switch (status.status) {
      case "IN_QUEUE":
        return { state: "queued" };
      case "IN_PROGRESS":
        return { state: "running" };
      case "COMPLETED":
        break;
      default:
        throw new ProviderError(
          `fal returned an unknown status: ${String(status.status)}`,
        );
    }
    if (typeof status.error === "string") {
      return { state: "failed", error: status.error };
    }
    const inferenceSeconds = asRecord(status.metrics).inference_time;
    try {
      return {
        state: "done",
        output: await withRetries(() => falFetch(requestUrl)),
        inferenceMs:
          typeof inferenceSeconds === "number"
            ? Math.round(inferenceSeconds * 1000)
            : undefined,
      };
    } catch (error) {
      if (
        error instanceof ProviderError &&
        error.status !== undefined &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429
      ) {
        return { state: "failed", error: error.message };
      }
      throw error;
    }
  },
  cancel: async (model, requestId) => {
    await falFetch(`${falRequestUrl(model, requestId)}/cancel`, { method: "PUT" });
  },
};

export function falRequestUrl(model: string, requestId: string) {
  const app = model.split("/").slice(0, 2).join("/");
  return `${QUEUE_URL}/${app}/requests/${requestId}`;
}

async function falFetch(url: string, init: JsonRequest = {}) {
  if (!env.FAL_KEY) {
    throw new ProviderError("FAL_KEY is not set on this Convex deployment.", 401);
  }
  return await requestJson(
    "fal",
    url,
    { ...init, headers: { Authorization: `Key ${env.FAL_KEY}`, ...init.headers } },
    CHECK_TIMEOUT_MS,
  );
}
