import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    FAL_KEY: v.optional(v.string()),
    FAL_WEBHOOK_BASE_URL: v.optional(v.string()),
  },
});
