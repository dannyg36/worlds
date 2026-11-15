import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fal } from "./fal";
import { ProviderError, requestJson } from "./provider";

type Call = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
};

function stubFetch(answer: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const call = {
        url: String(input),
        method: init.method ?? "GET",
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      return answer(call);
    }),
  );
  return calls;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.stubEnv("FAL_KEY", "test-key");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fal", () => {
  const REQUEST_URL = "https://queue.fal.run/fal-ai/z-image/requests/r1";

  test("submits to the queue with the key and a start timeout", async () => {
    const calls = stubFetch(() => json({ request_id: "r1", status: "IN_QUEUE" }));

    expect(
      await fal.submit("fal-ai/z-image/turbo", { prompt: "a diorama" }, 60_000),
    ).toEqual({ state: "pending", requestId: "r1" });
    expect(calls).toEqual([
      {
        url: "https://queue.fal.run/fal-ai/z-image/turbo",
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Key test-key",
          "X-Fal-Request-Start-Timeout": "60",
        }),
        body: { prompt: "a diorama" },
      },
    ]);
  });

  test("maps queue states and fetches the result once it completes", async () => {
    const states = ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"];
    const calls = stubFetch(({ url }) =>
      url.endsWith("/status")
        ? json({ status: states.shift(), metrics: { inference_time: 1.25 } })
        : json({ images: [{ url: "https://v3.fal.media/files/a.jpg" }] }),
    );

    expect(await fal.check("fal-ai/z-image/turbo", "r1")).toEqual({ state: "queued" });
    expect(await fal.check("fal-ai/z-image/turbo", "r1")).toEqual({ state: "running" });
    expect(await fal.check("fal-ai/z-image/turbo", "r1")).toEqual({
      state: "done",
      output: { images: [{ url: "https://v3.fal.media/files/a.jpg" }] },
      inferenceMs: 1250,
    });
    expect(calls.map((call) => call.url)).toEqual([
      `${REQUEST_URL}/status`,
      `${REQUEST_URL}/status`,
      `${REQUEST_URL}/status`,
      REQUEST_URL,
    ]);
  });

  test("reports a request that completed with an error", async () => {
    stubFetch(({ url }) =>
      url.endsWith("/status")
        ? json({ status: "COMPLETED", error: "CUDA out of memory" })
        : json({}),
    );
    expect(await fal.check("fal-ai/z-image/turbo", "r1")).toEqual({
      state: "failed",
      error: "CUDA out of memory",
    });

    stubFetch(({ url }) =>
      url.endsWith("/status")
        ? json({ status: "COMPLETED" })
        : json({ detail: [{ msg: "prompt is too long" }] }, 422),
    );
    expect(await fal.check("fal-ai/z-image/turbo", "r1")).toEqual({
      state: "failed",
      error: "fal 422: prompt is too long",
    });
  });

  test("cancels through the app's request URL", async () => {
    const calls = stubFetch(() => json({ status: "CANCELLATION_REQUESTED" }, 202));
    await fal.cancel!("fal-ai/trellis", "r9");
    expect(calls).toEqual([
      expect.objectContaining({
        url: "https://queue.fal.run/fal-ai/trellis/requests/r9/cancel",
        method: "PUT",
      }),
    ]);
  });

  test("refuses to call fal without FAL_KEY", async () => {
    vi.stubEnv("FAL_KEY", "");
    const calls = stubFetch(() => json({}));
    const submit = fal.submit("fal-ai/trellis", {}, 60_000);
    await expect(submit).rejects.toThrow("FAL_KEY is not set on this Convex deployment.");
    await expect(submit).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(0);
  });
});

test("requestJson gives up on a provider that never answers", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_input: RequestInfo | URL, init: RequestInit = {}) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    ),
  );
  const request = requestJson("GMI", "https://api.gmi-serving.com/v1/chat/completions", {}, 45_000);
  vi.advanceTimersByTime(45_000);
  await expect(request).rejects.toThrow(
    new ProviderError("GMI took longer than 45s to answer."),
  );
});
