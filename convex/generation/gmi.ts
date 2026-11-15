import { env } from "../_generated/server";
import {
  asRecord,
  errorDetail,
  ProviderError,
  requestJson,
  type Check,
  type JsonRequest,
  type Provider,
} from "./provider";

const CHAT_URL = "https://api.gmi-serving.com/v1/chat/completions";
const QUEUE_URL =
  "https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey/requests";
const CHECK_TIMEOUT_MS = 30_000;

export const gmiChat: Provider = {
  name: "gmi",
  submit: async (model, input, timeoutMs) => {
    const output = await gmiFetch(
      CHAT_URL,
      { method: "POST", body: JSON.stringify({ model, ...input }) },
      timeoutMs,
    );
    const { id } = asRecord(output);
    return {
      state: "done",
      output,
      requestId: typeof id === "string" ? id : undefined,
    };
  },
  check: async () => {
    throw new ProviderError("GMI chat completions finish when they're submitted.");
  },
};

export const gmiQueue: Provider = {
  name: "gmi",
  submit: async (model, input, timeoutMs) => {
    const body = asRecord(
      await gmiFetch(
        QUEUE_URL,
        { method: "POST", body: JSON.stringify({ model, payload: input }) },
        timeoutMs,
      ),
    );
    if (typeof body.request_id !== "string") {
      throw new ProviderError("GMI's queue did not return a request id.");
    }
    if (body.status === "success" || body.status === "failed") {
      const check = await checkRequest(body.request_id);
      if (check.state === "done") {
        return { state: "done", output: check.output, requestId: body.request_id };
      }
      if (check.state === "failed") {
        throw new ProviderError(check.error);
      }
    }
    return { state: "pending", requestId: body.request_id };
  },
  check: async (_model, requestId) => await checkRequest(requestId),
};

async function checkRequest(requestId: string): Promise<Check> {
  const body = asRecord(
    await gmiFetch(`${QUEUE_URL}/${requestId}`, {}, CHECK_TIMEOUT_MS),
  );
  switch (body.status) {
    case "success":
      return { state: "done", output: body.outcome };
    case "failed":
    case "cancelled":
      return {
        state: "failed",
        error: errorDetail(body.outcome) ?? `GMI marked the request ${body.status}.`,
      };
    case "processing":
      return { state: "running" };
    default:
      return { state: "queued" };
  }
}

async function gmiFetch(url: string, init: JsonRequest, timeoutMs: number) {
  if (!env.GMI_API_KEY) {
    throw new ProviderError("GMI_API_KEY is not set on this Convex deployment.", 401);
  }
  return await requestJson(
    "GMI",
    url,
    { ...init, headers: { Authorization: `Bearer ${env.GMI_API_KEY}` } },
    timeoutMs,
  );
}
