export type Submission =
  | { state: "done"; output: unknown; requestId?: string }
  | { state: "pending"; requestId: string };

export type Check =
  | { state: "queued" }
  | { state: "running" }
  | { state: "done"; output: unknown; inferenceMs?: number }
  | { state: "failed"; error: string };

export type Provider = {
  name: string;
  submit: (
    model: string,
    input: Record<string, unknown>,
    timeoutMs: number,
  ) => Promise<Submission>;
  check: (model: string, requestId: string) => Promise<Check>;
  cancel?: (model: string, requestId: string) => Promise<void>;
};

export type JsonRequest = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

const ATTEMPTS = 3;
const DOWNLOAD_TIMEOUT_MS = 60_000;

export async function requestJson(
  label: string,
  url: string,
  init: JsonRequest,
  timeoutMs: number,
): Promise<unknown> {
  const response = await fetchWithTimeout(
    label,
    url,
    {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    },
    timeoutMs,
  );
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const detail = errorDetail(body) ?? (text.slice(0, 300) || "no details");
    throw new ProviderError(`${label} ${response.status}: ${detail}`, response.status);
  }
  if (body === undefined) {
    throw new ProviderError(`${label} returned a response that isn't JSON.`);
  }
  return body;
}

export async function download(url: string): Promise<Blob> {
  const { origin, pathname } = new URL(url);
  return await withRetries(async () => {
    const response = await fetchWithTimeout(
      "The download",
      url,
      {},
      DOWNLOAD_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw new ProviderError(
        `Downloading ${origin}${pathname} failed with ${response.status}.`,
        response.status,
      );
    }
    return await response.blob();
  });
}

export async function withRetries<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const transient =
        !(error instanceof ProviderError) ||
        error.status === undefined ||
        error.status === 429 ||
        error.status >= 500;
      if (!transient || attempt >= ATTEMPTS) {
        throw error;
      }
    }
  }
}

export function errorDetail(body: unknown): string | undefined {
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
  return detail && typeof detail === "object" ? errorDetail(detail) : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

async function fetchWithTimeout(
  label: string,
  url: string,
  init: JsonRequest,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new ProviderError(
      controller.signal.aborted
        ? `${label} took longer than ${timeoutMs / 1000}s to answer.`
        : `${label} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
