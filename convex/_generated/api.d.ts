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
import type * as cache from "../cache.js";
import type * as dedup from "../dedup.js";
import type * as dedup_mutations from "../dedup_mutations.js";
import type * as eval from "../eval.js";
import type * as findings from "../findings.js";
import type * as lib_cluster from "../lib/cluster.js";
import type * as lib_eval from "../lib/eval.js";
import type * as lib_hash from "../lib/hash.js";
import type * as lib_path from "../lib/path.js";
import type * as orchestrator from "../orchestrator.js";
import type * as prompts from "../prompts.js";
import type * as repo from "../repo.js";
import type * as scans from "../scans.js";
import type * as scans_internal from "../scans_internal.js";
import type * as truth from "../truth.js";
import type * as truth_data from "../truth_data.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agents: typeof agents;
  cache: typeof cache;
  dedup: typeof dedup;
  dedup_mutations: typeof dedup_mutations;
  eval: typeof eval;
  findings: typeof findings;
  "lib/cluster": typeof lib_cluster;
  "lib/eval": typeof lib_eval;
  "lib/hash": typeof lib_hash;
  "lib/path": typeof lib_path;
  orchestrator: typeof orchestrator;
  prompts: typeof prompts;
  repo: typeof repo;
  scans: typeof scans;
  scans_internal: typeof scans_internal;
  truth: typeof truth;
  truth_data: typeof truth_data;
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
