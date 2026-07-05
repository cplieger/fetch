// createFetch — an isolated fetch instance with its own config, so multiple
// origins / credential-sets / SSR-per-request configs can coexist alongside
// the module-global default surface. Composes an isolated ConfigStore with the
// request-core and verb factories.
// ---------------------------------------------------------------------------

import { createConfigStore } from "./config.js";
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
  const store: ConfigStore = createConfigStore(initialConfig);
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
