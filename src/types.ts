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

/** Configuration for a fetch instance. Captured immutably by
 *  {@link createFetch} (shallow-copied and frozen at construction); a changed
 *  backend produces a new instance. An injection seam modelled on RTK's
 *  fetchBaseQuery: baseUrl, credentials, a header-preparation hook, and a
 *  custom fetch implementation for tests / SSR. */
export interface FetchConfig {
  /** Prepended to relative paths. The trailing `/` is stripped and a leading
   *  `/` is ensured on the path before joining.
   *
   *  CONTRACT: `path` is treated as a RELATIVE path. With `baseUrl` set, the
   *  configured scheme+host always precede it, so an absolute (`https://…`) or
   *  protocol-relative (`//host`) path is neutralised (kept as a path segment)
   *  and cannot override the origin. With `baseUrl` UNSET, `path` is passed to
   *  `fetch()` verbatim — the caller owns the full URL and must never pass
   *  untrusted input as the whole path. */
  baseUrl?: string;
  /** `RequestInit.credentials` mode applied to every request (e.g. `"include"`
   *  for cookies). */
  credentials?: RequestCredentials;
  /** Custom fetch implementation. Useful for SSR (isomorphic fetch) or tests. */
  fetchFn?: typeof fetch;
  /** Inject headers on every request. Mutate the provided instance and/or
   *  return a replacement (RTK convention: a returned `Headers` wins wholesale,
   *  otherwise the mutated instance is used). May be async (e.g. to read a
   *  token store) — read late-bound state (a token set after boot) from inside
   *  the hook rather than reconfiguring the instance. */
  prepareHeaders?: (headers: Headers) => Headers | undefined | Promise<Headers | undefined>;
  /** Optional cap on the response body size in bytes. Unset means unlimited
   *  (the current behavior). When set, a larger body is rejected instead of
   *  buffered; a defense-in-depth guard for the SSR/Node path against a
   *  hostile upstream. */
  maxResponseBytes?: number;
}

/** Successful result envelope. */
export interface ApiOk<T> {
  readonly ok: true;
  readonly status: number;
  /** The decoded / parsed response body. It is `undefined` for a 204 or any
   *  empty-body response, so a caller using the `*Raw` helpers on a
   *  204-capable endpoint should type `T` to include `undefined` (or branch on
   *  `status`). The null-collapsing helpers (`request` / `apiGet` / …) turn
   *  that `undefined` into `null`. */
  readonly data: T;
}

/** Failure result envelope. Never thrown — always returned by `requestRaw`. */
export interface ApiErr {
  readonly ok: false;
  /** HTTP status, or 0 for a network / timeout / cancelled / invalid failure. */
  readonly status: number;
  /** Human-readable message. */
  readonly error: string;
  /** Machine code: `"network"` | `"timeout"` | `"cancelled"` | `"decode"` |
   *  `"invalid"`, or a server-supplied code lifted from the error body.
   *  `"invalid"` marks a client-side build failure (an un-encodable body, a bad
   *  header name/value, a bad `timeoutMs`, or a throwing `prepareHeaders`) that
   *  never reached the network.
   *
   *  This field is dual-purpose: a server-controlled body value shares the
   *  namespace with the library's own control codes, so a compromised or
   *  malicious upstream can spoof a reserved value. Disambiguate by `status`,
   *  never by `code` alone: the reserved library codes carry `status === 0`
   *  (except `"decode"`, which carries the real 2xx status), whereas a lifted
   *  server-supplied code always carries the real non-2xx HTTP status. A
   *  consumer branching on a reserved code (e.g. `r.code === "cancelled"`) MUST
   *  also check `status` to avoid misclassifying a server error. */
  readonly code?: string;
  /** Lifted from the error body's `request_id` / `requestId`, when present. */
  readonly requestId?: string;
  /** Response headers, present only when an HTTP response was actually
   *  received: a non-2xx error, or a 2xx whose body failed decoding (both
   *  carry a real `status > 0`). Absent on network / timeout / cancelled /
   *  invalid failures, which have no response. Lets a caller read
   *  error-response diagnostics (e.g. `Retry-After` on a 429) without leaving
   *  the envelope. Success responses deliberately do not carry headers —
   *  drop to raw `fetch` for full response-metadata access. */
  readonly headers?: Headers;
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
  /** Skip reading a 2xx response body entirely: the request resolves ok with
   *  `data: undefined` (`null` after null-collapsing) and any `decoder` is not
   *  invoked. Non-2xx error bodies are still parsed for the error envelope.
   *  For endpoints whose success body is irrelevant or non-JSON (e.g. a
   *  DELETE answering plain text). */
  ignoreBody?: boolean;
}

/** The non-throwing request core signature: always resolves to an
 *  {@link ApiResult}, never throws. Shared by the default instance and every
 *  {@link createFetch} instance. */
export type RequestRawFn = <T>(
  method: HttpMethod,
  path: string,
  opts?: RequestOptions<T>,
) => Promise<ApiResult<T>>;

/** The null-collapsing request signature: the decoded body, or `null` on any
 *  error / empty body. */
export type RequestFn = <T>(
  method: HttpMethod,
  path: string,
  opts?: RequestOptions<T>,
) => Promise<T | null>;
