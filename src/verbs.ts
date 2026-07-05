// Thin per-verb helpers over a request core. The plain helpers null-collapse
// (return T | null); the *Raw helpers surface the full ApiResult envelope; the
// *Typed helpers thread a decoder for runtime validation. makeVerbs binds a
// (request, requestRaw) pair — the module-global default, or a per-instance
// pair from createFetch. The exported apiGet/… are the default bindings.
// ---------------------------------------------------------------------------

import { request as defaultRequest, requestRaw as defaultRequestRaw } from "./request.js";
import type { ApiResult, Decoder, RequestFn, RequestOptions, RequestRawFn } from "./types.js";

/** The bundle of 12 verb helpers a fetch instance exposes. */
export interface FetchVerbs {
  /** GET; returns the decoded body or `null` on any error. */
  apiGet: <T>(path: string, opts?: RequestOptions<T>) => Promise<T | null>;
  /** POST a JSON body; returns the decoded body or `null` on any error. */
  apiPost: <T>(path: string, body?: unknown, opts?: RequestOptions<T>) => Promise<T | null>;
  /** PUT a JSON body; returns the decoded body or `null` on any error. */
  apiPut: <T>(path: string, body?: unknown, opts?: RequestOptions<T>) => Promise<T | null>;
  /** PATCH a JSON body; returns the decoded body or `null` on any error. */
  apiPatch: <T>(path: string, body?: unknown, opts?: RequestOptions<T>) => Promise<T | null>;
  /** DELETE; returns the decoded body or `null` on any error. */
  apiDelete: <T>(path: string, opts?: RequestOptions<T>) => Promise<T | null>;
  /** GET with runtime validation; returns the decoded body or `null` on any error. */
  apiGetTyped: <T>(
    path: string,
    decoder: Decoder<T>,
    opts?: RequestOptions<T>,
  ) => Promise<T | null>;
  /** POST with runtime validation; returns the decoded body or `null` on any error. */
  apiPostTyped: <T>(
    path: string,
    body: unknown,
    decoder: Decoder<T>,
    opts?: RequestOptions<T>,
  ) => Promise<T | null>;
  /** GET; returns the full {@link ApiResult} envelope. */
  apiGetRaw: <T>(path: string, opts?: RequestOptions<T>) => Promise<ApiResult<T>>;
  /** POST a JSON body; returns the full {@link ApiResult} envelope. */
  apiPostRaw: <T>(path: string, body?: unknown, opts?: RequestOptions<T>) => Promise<ApiResult<T>>;
  /** PUT a JSON body; returns the full {@link ApiResult} envelope. */
  apiPutRaw: <T>(path: string, body?: unknown, opts?: RequestOptions<T>) => Promise<ApiResult<T>>;
  /** PATCH a JSON body; returns the full {@link ApiResult} envelope. */
  apiPatchRaw: <T>(path: string, body?: unknown, opts?: RequestOptions<T>) => Promise<ApiResult<T>>;
  /** DELETE; returns the full {@link ApiResult} envelope. */
  apiDeleteRaw: <T>(path: string, opts?: RequestOptions<T>) => Promise<ApiResult<T>>;
}

/** Bind the 12 verb helpers to a `(request, requestRaw)` pair. */
export function makeVerbs(request: RequestFn, requestRaw: RequestRawFn): FetchVerbs {
  return {
    apiGet<T>(path: string, opts?: RequestOptions<T>): Promise<T | null> {
      return request<T>("GET", path, opts);
    },
    apiPost<T>(path: string, body?: unknown, opts?: RequestOptions<T>): Promise<T | null> {
      return request<T>("POST", path, { ...opts, body });
    },
    apiPut<T>(path: string, body?: unknown, opts?: RequestOptions<T>): Promise<T | null> {
      return request<T>("PUT", path, { ...opts, body });
    },
    apiPatch<T>(path: string, body?: unknown, opts?: RequestOptions<T>): Promise<T | null> {
      return request<T>("PATCH", path, { ...opts, body });
    },
    apiDelete<T>(path: string, opts?: RequestOptions<T>): Promise<T | null> {
      return request<T>("DELETE", path, opts);
    },
    apiGetTyped<T>(path: string, decoder: Decoder<T>, opts?: RequestOptions<T>): Promise<T | null> {
      return request<T>("GET", path, { ...opts, decoder });
    },
    apiPostTyped<T>(
      path: string,
      body: unknown,
      decoder: Decoder<T>,
      opts?: RequestOptions<T>,
    ): Promise<T | null> {
      return request<T>("POST", path, { ...opts, body, decoder });
    },
    apiGetRaw<T>(path: string, opts?: RequestOptions<T>): Promise<ApiResult<T>> {
      return requestRaw<T>("GET", path, opts);
    },
    apiPostRaw<T>(path: string, body?: unknown, opts?: RequestOptions<T>): Promise<ApiResult<T>> {
      return requestRaw<T>("POST", path, { ...opts, body });
    },
    apiPutRaw<T>(path: string, body?: unknown, opts?: RequestOptions<T>): Promise<ApiResult<T>> {
      return requestRaw<T>("PUT", path, { ...opts, body });
    },
    apiPatchRaw<T>(path: string, body?: unknown, opts?: RequestOptions<T>): Promise<ApiResult<T>> {
      return requestRaw<T>("PATCH", path, { ...opts, body });
    },
    apiDeleteRaw<T>(path: string, opts?: RequestOptions<T>): Promise<ApiResult<T>> {
      return requestRaw<T>("DELETE", path, opts);
    },
  };
}

// --- Default instance verb helpers (bound to the module-global default) ----
const defaultVerbs = makeVerbs(defaultRequest, defaultRequestRaw);

export const {
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
  apiGetTyped,
  apiPostTyped,
  apiGetRaw,
  apiPostRaw,
  apiPutRaw,
  apiPatchRaw,
  apiDeleteRaw,
} = defaultVerbs;
