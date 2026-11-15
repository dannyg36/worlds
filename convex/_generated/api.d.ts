/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as crons from "../crons.js";
import type * as deviceAuth from "../deviceAuth.js";
import type * as expoPush from "../expoPush.js";
import type * as feed from "../feed.js";
import type * as friends from "../friends.js";
import type * as generation_fal from "../generation/fal.js";
import type * as generation_gmi from "../generation/gmi.js";
import type * as generation_models from "../generation/models.js";
import type * as generation_provider from "../generation/provider.js";
import type * as generation_scene from "../generation/scene.js";
import type * as generation_sceneWriterPrompt from "../generation/sceneWriterPrompt.js";
import type * as generation_tables from "../generation/tables.js";
import type * as localTime from "../localTime.js";
import type * as memory from "../memory.js";
import type * as memoryCheck from "../memoryCheck.js";
import type * as notifications from "../notifications.js";
import type * as pipeline from "../pipeline.js";
import type * as profiles from "../profiles.js";
import type * as sha256 from "../sha256.js";
import type * as sharing from "../sharing.js";
import type * as worlds from "../worlds.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  crons: typeof crons;
  deviceAuth: typeof deviceAuth;
  expoPush: typeof expoPush;
  feed: typeof feed;
  friends: typeof friends;
  "generation/fal": typeof generation_fal;
  "generation/gmi": typeof generation_gmi;
  "generation/models": typeof generation_models;
  "generation/provider": typeof generation_provider;
  "generation/scene": typeof generation_scene;
  "generation/sceneWriterPrompt": typeof generation_sceneWriterPrompt;
  "generation/tables": typeof generation_tables;
  localTime: typeof localTime;
  memory: typeof memory;
  memoryCheck: typeof memoryCheck;
  notifications: typeof notifications;
  pipeline: typeof pipeline;
  profiles: typeof profiles;
  sha256: typeof sha256;
  sharing: typeof sharing;
  worlds: typeof worlds;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
