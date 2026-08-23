// Instance assembly. createFetch captures a shallow-copied, frozen config and
// composes it with the request-core and verb factories into a fetch instance.
// It is the ONLY config surface: there is no module-global default and no
// post-construction mutation — a changed backend produces a new instance
// (late-bound per-request state belongs in the prepareHeaders hook, which runs
// on every call).
// ---------------------------------------------------------------------------

import { makeRequest, makeRequestRaw } from "./request.js";
import { makeVerbs } from "./verbs.js";
import type { FetchVerbs } from "./verbs.js";
import type { FetchConfig, RequestFn, RequestRawFn } from "./types.js";

/** An isolated fetch instance: its own immutable config, request core, and 12
 *  verb helpers. Returned by {@link createFetch}. */
export interface FetchInstance extends FetchVerbs {
  /** The non-throwing request core bound to this instance. */
  requestRaw: RequestRawFn;
  /** The null-collapsing request bound to this instance. */
  request: RequestFn;
}

/**
 * Create an isolated fetch instance. `config` is shallow-copied and frozen at
 * construction — the single assembly site for the request core, its
 * null-collapsing wrapper, and the 12 verb helpers. Two instances never share
 * config; a changed backend produces a new instance (the replace-semantics
 * every consumer already models). A hook that must read late-bound state (a
 * token set after boot) reads it from inside `prepareHeaders`, which runs per
 * request.
 *
 * Throws a `TypeError` on a `maxResponseBytes` of `NaN`: nothing is ever
 * `> NaN`, so such a cap would read unbounded while the caller believes a cap
 * is set (the shape `Number(process.env.MAX_BYTES)` produces when the variable
 * is unset). This is the one knob whose purpose is bounding a hostile upstream,
 * so it fails loudly here — once, at construction — rather than per request.
 * `Infinity` is accepted and means unlimited, as does leaving it unset.
 *
 * @example
 * ```ts
 * export const api = createFetch({ baseUrl: "https://api.example.com/v1", credentials: "include" });
 * const user = await api.apiGet<User>("/me");
 * ```
 */
export function createFetch(config: FetchConfig = {}): FetchInstance {
  // An unset cap needs no arm of its own: Number.isNaN does not coerce, so
  // undefined is not NaN.
  if (Number.isNaN(config.maxResponseBytes)) {
    throw new TypeError(
      "createFetch: maxResponseBytes must be a byte count (or Infinity for no cap), not NaN",
    );
  }
  const cfg: FetchConfig = Object.freeze({ ...config });
  const requestRaw = makeRequestRaw(cfg);
  const request = makeRequest(requestRaw);
  const verbs = makeVerbs(request, requestRaw);
  return {
    ...verbs,
    requestRaw,
    request,
  };
}
