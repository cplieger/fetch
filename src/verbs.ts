// Thin per-verb helpers over the request core. The plain helpers null-collapse
// (return T | null); the *Raw helpers surface the full ApiResult envelope; the
// *Typed helpers thread a decoder for runtime validation.
// ---------------------------------------------------------------------------

import { request, requestRaw } from "./request.js";
import type { ApiResult, Decoder, RequestOptions } from "./types.js";

// --- Null-collapsing helpers (return the data, or null on any error) -------

/** GET; returns the decoded body or `null` on any error. */
export function apiGet<T>(path: string, opts?: RequestOptions<T>): Promise<T | null> {
  return request<T>("GET", path, opts);
}

/** POST a JSON body; returns the decoded body or `null` on any error. */
export function apiPost<T>(
  path: string,
  body?: unknown,
  opts?: RequestOptions<T>,
): Promise<T | null> {
  return request<T>("POST", path, { ...opts, body });
}

/** PUT a JSON body; returns the decoded body or `null` on any error. */
export function apiPut<T>(
  path: string,
  body?: unknown,
  opts?: RequestOptions<T>,
): Promise<T | null> {
  return request<T>("PUT", path, { ...opts, body });
}

/** PATCH a JSON body; returns the decoded body or `null` on any error. */
export function apiPatch<T>(
  path: string,
  body?: unknown,
  opts?: RequestOptions<T>,
): Promise<T | null> {
  return request<T>("PATCH", path, { ...opts, body });
}

/** DELETE; returns the decoded body or `null` on any error. */
export function apiDelete<T>(path: string, opts?: RequestOptions<T>): Promise<T | null> {
  return request<T>("DELETE", path, opts);
}

// --- Decoder-validated helpers (null on any error, including a decode miss) -

/** GET with runtime validation; returns the decoded body or `null` on any error. */
export function apiGetTyped<T>(
  path: string,
  decoder: Decoder<T>,
  opts?: RequestOptions<T>,
): Promise<T | null> {
  return request<T>("GET", path, { ...opts, decoder });
}

/** POST with runtime validation; returns the decoded body or `null` on any error. */
export function apiPostTyped<T>(
  path: string,
  body: unknown,
  decoder: Decoder<T>,
  opts?: RequestOptions<T>,
): Promise<T | null> {
  return request<T>("POST", path, { ...opts, body, decoder });
}

// --- Envelope helpers (return the full ApiResult) --------------------------

/** GET; returns the full {@link ApiResult} envelope. */
export function apiGetRaw<T>(path: string, opts?: RequestOptions<T>): Promise<ApiResult<T>> {
  return requestRaw<T>("GET", path, opts);
}

/** POST a JSON body; returns the full {@link ApiResult} envelope. */
export function apiPostRaw<T>(
  path: string,
  body?: unknown,
  opts?: RequestOptions<T>,
): Promise<ApiResult<T>> {
  return requestRaw<T>("POST", path, { ...opts, body });
}

/** PUT a JSON body; returns the full {@link ApiResult} envelope. */
export function apiPutRaw<T>(
  path: string,
  body?: unknown,
  opts?: RequestOptions<T>,
): Promise<ApiResult<T>> {
  return requestRaw<T>("PUT", path, { ...opts, body });
}

/** PATCH a JSON body; returns the full {@link ApiResult} envelope. */
export function apiPatchRaw<T>(
  path: string,
  body?: unknown,
  opts?: RequestOptions<T>,
): Promise<ApiResult<T>> {
  return requestRaw<T>("PATCH", path, { ...opts, body });
}

/** DELETE; returns the full {@link ApiResult} envelope. */
export function apiDeleteRaw<T>(path: string, opts?: RequestOptions<T>): Promise<ApiResult<T>> {
  return requestRaw<T>("DELETE", path, opts);
}
