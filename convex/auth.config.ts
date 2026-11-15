import type { AuthConfig } from "convex/server";
import { env } from "./_generated/server";
import { DEVICE_TOKEN_AUDIENCE } from "./deviceAuth";

export default {
  providers: [
    {
      type: "customJwt",
      issuer: env.CONVEX_CLOUD_URL,
      jwks: `${env.CONVEX_CLOUD_URL}/.well-known/jwks.json`,
      algorithm: "ES256",
      applicationID: DEVICE_TOKEN_AUDIENCE,
    },
  ],
} satisfies AuthConfig;
