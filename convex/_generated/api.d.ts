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
import type * as generation_fal from "../generation/fal.js";
import type * as generation_gmi from "../generation/gmi.js";
import type * as generation_models from "../generation/models.js";
import type * as generation_provider from "../generation/provider.js";
import type * as generation_scene from "../generation/scene.js";
import type * as generation_sceneWriterPrompt from "../generation/sceneWriterPrompt.js";
import type * as generation_tables from "../generation/tables.js";
import type * as memory from "../memory.js";
import type * as memoryCheck from "../memoryCheck.js";
import type * as pipeline from "../pipeline.js";
import type * as worlds from "../worlds.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  crons: typeof crons;
  "generation/fal": typeof generation_fal;
  "generation/gmi": typeof generation_gmi;
  "generation/models": typeof generation_models;
  "generation/provider": typeof generation_provider;
  "generation/scene": typeof generation_scene;
  "generation/sceneWriterPrompt": typeof generation_sceneWriterPrompt;
  "generation/tables": typeof generation_tables;
  memory: typeof memory;
  memoryCheck: typeof memoryCheck;
  pipeline: typeof pipeline;
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
