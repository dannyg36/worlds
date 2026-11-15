/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as deviceAuth from "../deviceAuth.js";
import type * as expoPush from "../expoPush.js";
import type * as feed from "../feed.js";
import type * as friends from "../friends.js";
import type * as localTime from "../localTime.js";
import type * as memory from "../memory.js";
import type * as memoryCheck from "../memoryCheck.js";
import type * as notifications from "../notifications.js";
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
  crons: typeof crons;
  deviceAuth: typeof deviceAuth;
  expoPush: typeof expoPush;
  feed: typeof feed;
  friends: typeof friends;
  localTime: typeof localTime;
  memory: typeof memory;
  memoryCheck: typeof memoryCheck;
  notifications: typeof notifications;
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
