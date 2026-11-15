const QUEUE_URL = "https://queue.fal.run";
const ATTEMPTS = 3;

export class FalError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FalError";
  }
}

export type QueuedRequest = {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  cancelUrl: string;
};

export type RequestStatus = {
  state: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
  error?: string;
  inferenceMs?: number;
};

export async function submit(
  key: string,
  endpoint: string,
  input: Record<string, unknown>,
  options: { webhookUrl?: string; startTimeoutMs: number },
): Promise<QueuedRequest> {
  const url = new URL(`${QUEUE_URL}/${endpoint}`);
  if (options.webhookUrl) {
    url.searchParams.set("fal_webhook", options.webhookUrl);
  }
  const body = asRecord(
    await falFetch(key, url.toString(), {
      method: "POST",
      headers: {
        "X-Fal-Request-Start-Timeout": String(
          Math.ceil(options.startTimeoutMs / 1000),
        ),
      },
      body: JSON.stringify(input),
    }),
  );
  const { request_id, status_url, response_url, cancel_url } = body;
  if (
    typeof request_id !== "string" ||
    typeof status_url !== "string" ||
    typeof response_url !== "string" ||
    typeof cancel_url !== "string"
  ) {
    throw new FalError("fal's queue did not return a request id.");
  }
  return {
    requestId: request_id,
    statusUrl: status_url,
    responseUrl: response_url,
    cancelUrl: cancel_url,
  };
}

export async function status(
  key: string,
  statusUrl: string,
): Promise<RequestStatus> {
  const body = asRecord(await falFetch(key, statusUrl));
  const state = body.status;
  if (state !== "IN_QUEUE" && state !== "IN_PROGRESS" && state !== "COMPLETED") {
    throw new FalError(`fal returned an unknown status: ${String(state)}`);
  }
  const inferenceSeconds = asRecord(body.metrics).inference_time;
  return {
    state,
    error: typeof body.error === "string" ? body.error : undefined,
    inferenceMs:
      typeof inferenceSeconds === "number"
        ? Math.round(inferenceSeconds * 1000)
        : undefined,
  };
}

export async function result(key: string, responseUrl: string) {
  return await withRetries(() => falFetch(key, responseUrl));
}

export async function cancel(key: string, cancelUrl: string) {
  await fetch(cancelUrl, {
    method: "PUT",
    headers: { Authorization: `Key ${key}` },
  });
}

export async function download(url: string): Promise<Blob> {
  return await withRetries(async () => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new FalError(
        `Downloading ${url} failed with ${response.status}.`,
        response.status,
      );
    }
    return await response.blob();
  });
}

export function falErrorDetail(body: unknown): string | undefined {
  const fields = asRecord(body);
  const detail = fields.detail ?? fields.error ?? fields.message;
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const message = asRecord(item).msg;
        return typeof message === "string" ? message : JSON.stringify(item);
      })
      .join("; ");
  }
  return undefined;
}

async function falFetch(
  key: string,
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const detail = falErrorDetail(body) ?? (text.slice(0, 300) || "no details");
    throw new FalError(`fal ${response.status}: ${detail}`, response.status);
  }
  if (body === undefined) {
    throw new FalError("fal returned a response that isn't JSON.");
  }
  return body;
}

async function withRetries<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const transient =
        !(error instanceof FalError) ||
        error.status === 429 ||
        (error.status ?? 0) >= 500;
      if (!transient || attempt >= ATTEMPTS) {
        throw error;
      }
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
