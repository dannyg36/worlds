import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    GMI_API_KEY: v.optional(v.string()),
    FAL_KEY: v.optional(v.string()),
    SUPERMEMORY_API_KEY: v.optional(v.string()),
  },
});
