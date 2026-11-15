import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { falErrorDetail } from "./generation/fal";
import { verifyFalWebhook } from "./generation/falWebhook";

const http = httpRouter();

http.route({
  path: "/fal/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.arrayBuffer();
    if (!(await verifyFalWebhook(request.headers, body))) {
      return new Response("Invalid signature", { status: 401 });
    }
    let delivery: Record<string, unknown>;
    try {
      delivery = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const runId = new URL(request.url).searchParams.get("runId");
    const { request_id: requestId, status } = delivery ?? {};
    if (
      !runId ||
      typeof requestId !== "string" ||
      (status !== "OK" && status !== "ERROR")
    ) {
      return new Response("Unexpected webhook", { status: 400 });
    }
    await ctx.runMutation(internal.pipeline.receiveWebhook, {
      runId,
      requestId,
      error:
        status === "ERROR"
          ? [delivery.error, falErrorDetail(delivery.payload)]
              .filter((part) => typeof part === "string" && part)
              .join(": ") || "fal reported an error."
          : undefined,
    });
    return new Response(null, { status: 200 });
  }),
});

export default http;
