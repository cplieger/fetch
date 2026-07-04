// Public types for @cplieger/fetch. Pure types — no imports, no runtime
// behavior — so any module in the library can depend on this without pulling
// in config / request / verbs.
// ---------------------------------------------------------------------------

/** HTTP verbs the wrapper speaks. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * A runtime validator for a 2xx response body. Returns the typed value on a
 * valid shape, or THROWS on a mismatch. `@cplieger/fetch` ships only this type
 * plus the optional invocation seam — decoder combinators are deliberately out
 * of scope, so each consumer supplies its own validators (hand-written, zod,
 * valibot, …).
 */
export type Decoder<T> = (value: unknown) => T;

/** Successful result envelope. `data` is the decoded/parsed body (or
 *  `undefined` for a 204 / empty body). */
export interface ApiOk<T> {
  readonly ok: true;
  readonly status: number;
  readonly data: T;
}

/** Failure result envelope. Never thrown — always returned by `requestRaw`. */
export interface ApiErr {
  readonly ok: false;
  /** HTTP status, or 0 for a network / timeout / cancelled failure. */
  readonly status: number;
  /** Human-readable message. */
  readonly error: string;
  /** Machine code: `"network"` | `"timeout"` | `"cancelled"` | `"decode"`, or
   *  a server-supplied code lifted from the error body. */
  readonly code?: string;
  /** Lifted from the error body's `request_id` / `requestId`, when present. */
  readonly requestId?: string;
}

/** Discriminated union returned by `requestRaw` and the `*Raw` verb helpers. */
export type ApiResult<T> = ApiOk<T> | ApiErr;

/** Per-request options. */
export interface RequestOptions<T = unknown> {
  /** JSON-encoded for non-GET requests when defined. */
  body?: unknown;
  /** Caller cancellation signal, composed with the request timeout. */
  signal?: AbortSignal;
  /** Per-request headers, merged before the global `prepareHeaders` hook. */
  headers?: Record<string, string> | Headers;
  /** Optional runtime validation applied to a 2xx body. */
  decoder?: Decoder<T>;
  /** Overrides the default request timeout (`API_TIMEOUT_MS`) for this request. */
  timeoutMs?: number;
}
