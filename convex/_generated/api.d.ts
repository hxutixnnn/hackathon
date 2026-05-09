/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents from "../agents.js";
import type * as findings from "../findings.js";
import type * as orchestrator from "../orchestrator.js";
import type * as prompts from "../prompts.js";
import type * as reducer from "../reducer.js";
import type * as repo from "../repo.js";
import type * as scans from "../scans.js";
import type * as scans_internal from "../scans_internal.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agents: typeof agents;
  findings: typeof findings;
  orchestrator: typeof orchestrator;
  prompts: typeof prompts;
  reducer: typeof reducer;
  repo: typeof repo;
  scans: typeof scans;
  scans_internal: typeof scans_internal;
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

export declare const components: {
  agentPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"agentPool">;
};
