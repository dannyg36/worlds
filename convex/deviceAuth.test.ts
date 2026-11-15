/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { DEVICE_TOKEN_AUDIENCE } from "./deviceAuth";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const SECRET = "a".repeat(64);

test("a wrong device secret gets no token", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.deviceAuth.register, { secret: SECRET });

  expect(
    await t.mutation(api.deviceAuth.token, { secret: "b".repeat(64) }),
  ).toBeNull();
  expect(await t.mutation(api.deviceAuth.token, { secret: "" })).toBeNull();
});

test("a registered secret gets a short-lived token the deployment signed for that device", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.deviceAuth.register, { secret: SECRET });
  await t.mutation(api.deviceAuth.register, { secret: SECRET });

  const token = await t.mutation(api.deviceAuth.token, { secret: SECRET });
  expect(token).toEqual(expect.any(String));
  const [header, payload, signature] = token!.split(".");
  const { keys } = await t.jwks();
  const key = await crypto.subtle.importKey(
    "jwk",
    keys[0],
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64UrlDecode(signature),
    new TextEncoder().encode(`${header}.${payload}`),
  );
  expect(verified).toBe(true);

  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
  const devices = await t.run(async (ctx) => ctx.db.query("devices").collect());
  expect(devices).toHaveLength(1);
  expect(devices[0]).not.toHaveProperty("secret");
  expect(claims).toMatchObject({
    sub: devices[0]._id,
    aud: DEVICE_TOKEN_AUDIENCE,
  });
  expect(claims.exp - claims.iat).toBe(60 * 60);
});

test("register refuses a short secret", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.mutation(api.deviceAuth.register, { secret: "short" }),
  ).rejects.toThrow("A device secret must be 32 to 256 characters.");
});

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(
    atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
    (char) => char.charCodeAt(0),
  );
}
