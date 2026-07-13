// Instance assembly. buildInstance composes a ConfigStore with the request-core
// and verb factories into a fetch instance; it is the single assembly site used
// by both createFetch (a fresh isolated store, for multiple origins /
// credential-sets / SSR-per-request) and the module-global default surface (the
// top-level requestRaw / request / apiGet…, bound to the shared defaultStore).
// ---------------------------------------------------------------------------

import { createConfigStore, defaultStore } from "./config.js";
import type { ConfigStore, FetchConfig } from "./config.js";
import { makeRequest, makeRequestRaw } from "./request.js";
import { makeVerbs } from "./verbs.js";
import type { FetchVerbs } from "./verbs.js";
import type { RequestFn, RequestRawFn } from "./types.js";

/** An isolated fetch instance: its own config, request core, and 12 verb
 *  helpers. Returned by {@link createFetch}. */
export interface FetchInstance extends FetchVerbs {
  /** Shallow-merge config into this instance (accumulate, not replace); the
   *  {@link createFetch} analogue of the default `configureFetch`. */
  configure: (config: FetchConfig) => void;
  /** The non-throwing request core bound to this instance. */
  requestRaw: RequestRawFn;
  /** The null-collapsing request bound to this instance. */
  request: RequestFn;
}

/**
 * Assemble a fetch instance from a config store: the request core, its
 * null-collapsing wrapper, and the 12 verb helpers all bound to `store`, plus a
 * `configure` that shallow-merges into it. The single composition site shared
 * by {@link createFetch} (a fresh isolated store) and the module-global default
 * surface below (the shared {@link defaultStore}), so the assembly recipe lives
 * in exactly one place.
 */
function buildInstance(store: ConfigStore): FetchInstance {
  const requestRaw = makeRequestRaw(store.get);
  const request = makeRequest(requestRaw);
  const verbs = makeVerbs(request, requestRaw);
  return {
    ...verbs,
    requestRaw,
    request,
    configure: (config: FetchConfig): void => {
      store.configure(config);
    },
  };
}

/**
 * Create an isolated fetch instance. `initialConfig` seeds its config;
 * `instance.configure(…)` mutates it later (shallow-merge). Unlike the
 * module-global {@link configureFetch}, two instances never share config, so
 * per-tenant / multi-origin / SSR-per-request usage needs no global reset.
 *
 * @example
 * ```ts
 * const tenantApi = createFetch({ baseUrl: "https://t1.example.com", credentials: "include" });
 * const user = await tenantApi.apiGet<User>("/me");
 * ```
 */
export function createFetch(initialConfig: FetchConfig = {}): FetchInstance {
  return buildInstance(createConfigStore(initialConfig));
}

// --- Default instance (bound to the module-global config store) ------------
// The byte-compatible top-level surface: requestRaw / request / apiGet… read
// the config that configureFetch / resetFetchConfig mutate. Built from the same
// buildInstance recipe as createFetch, so there is one assembly site. Individual
// typed re-exports (not `export const { … } = defaultInstance`): JSR's
// no-slow-types check requires each public symbol to carry an explicit type.
const defaultInstance: FetchInstance = buildInstance(defaultStore);

/** The default-instance non-throwing request core. See {@link makeRequestRaw}. */
export const requestRaw: RequestRawFn = defaultInstance.requestRaw;
/** The default-instance null-collapsing request. See {@link makeRequest}. */
export const request: RequestFn = defaultInstance.request;

export const apiGet: FetchVerbs["apiGet"] = defaultInstance.apiGet;
export const apiPost: FetchVerbs["apiPost"] = defaultInstance.apiPost;
export const apiPut: FetchVerbs["apiPut"] = defaultInstance.apiPut;
export const apiPatch: FetchVerbs["apiPatch"] = defaultInstance.apiPatch;
export const apiDelete: FetchVerbs["apiDelete"] = defaultInstance.apiDelete;
export const apiGetTyped: FetchVerbs["apiGetTyped"] = defaultInstance.apiGetTyped;
export const apiPostTyped: FetchVerbs["apiPostTyped"] = defaultInstance.apiPostTyped;
export const apiGetRaw: FetchVerbs["apiGetRaw"] = defaultInstance.apiGetRaw;
export const apiPostRaw: FetchVerbs["apiPostRaw"] = defaultInstance.apiPostRaw;
export const apiPutRaw: FetchVerbs["apiPutRaw"] = defaultInstance.apiPutRaw;
export const apiPatchRaw: FetchVerbs["apiPatchRaw"] = defaultInstance.apiPatchRaw;
export const apiDeleteRaw: FetchVerbs["apiDeleteRaw"] = defaultInstance.apiDeleteRaw;
