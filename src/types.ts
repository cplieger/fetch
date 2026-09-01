/** Public types for @cplieger/fetch. No imports, no runtime behavior. */

/** HTTP verbs the wrapper speaks. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * A runtime validator for a 2xx response body: returns the typed value or
 * THROWS on a mismatch. Ships no combinators — each consumer supplies its own
 * validators (hand-written, zod, valibot, …).
 */
export type Decoder<T> = (value: unknown) => T;

/** Configuration for a fetch instance. Captured immutably by
 *  {@link createFetch} (shallow-copied and frozen at construction); a changed
 *  backend produces a new instance. */
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
   *  return a replacement (a returned `Headers` wins wholesale, otherwise the
   *  mutated instance is used). May be async — read late-bound state (a token
   *  set after boot) from inside the hook rather than reconfiguring the
   *  instance. */
  prepareHeaders?: (headers: Headers) => Headers | undefined | Promise<Headers | undefined>;
  /** Optional cap on the response body size in bytes. Unset or `Infinity`
   *  means unlimited. When set, a larger body is rejected instead of buffered.
   *  `NaN` is rejected by {@link createFetch} with a `TypeError`: nothing is
   *  `> NaN`, so it would read unbounded while looking like a configured cap. */
  maxResponseBytes?: number;
}

/** Successful result envelope. */
export interface ApiOk<T> {
  readonly ok: true;
  readonly status: number;
  /** The decoded / parsed response body. `undefined` for a 204 or any
   *  empty-body response; the null-collapsing helpers turn that into `null`. */
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
   *
   *  SECURITY: this field is dual-purpose — a server-controlled body value
   *  shares the namespace with the library's own control codes, so a
   *  malicious upstream can spoof a reserved value. Disambiguate by `status`,
   *  never by `code` alone: the reserved codes carry `status === 0` (except
   *  `"decode"`, which carries the real 2xx status); a lifted server code
   *  always carries the real non-2xx status. */
  readonly code?: string;
  /** Lifted from the error body's `request_id` / `requestId`, when present. */
  readonly requestId?: string;
  /** The parsed JSON body of the failed response, present when a real HTTP
   *  response carried parseable JSON (any shape). Absent on network / timeout
   *  / cancelled / invalid failures and on non-JSON / empty bodies.
   *
   *  SECURITY: server-controlled content, same trust level as `error` —
   *  validate the shape before reading fields, and render any text from it
   *  via textContent, never innerHTML. */
  readonly body?: unknown;
  /** Response headers, present only when an HTTP response was actually
   *  received (a non-2xx error, or a 2xx whose body failed decoding). Absent
   *  on network / timeout / cancelled / invalid failures. Success responses
   *  deliberately do not carry headers — drop to raw `fetch` for that. */
  readonly headers?: Headers;
}

/** Discriminated union returned by `requestRaw` and the `*Raw` verb helpers. */
export type ApiResult<T> = ApiOk<T> | ApiErr;

/** Per-request options. */
export interface RequestOptions<T = unknown> {
  /** JSON-encoded for non-GET requests when defined. */
  body?: unknown;
  /** Pre-encoded request body for non-GET requests, sent as-is with NO JSON
   *  encoding and NO automatic Content-Type — the caller owns the type via
   *  `headers`. Mutually exclusive with `body` (both set is a client-side
   *  `"invalid"` failure). */
  rawBody?: BodyInit;
  /** Caller cancellation signal, composed with the request timeout. */
  signal?: AbortSignal;
  /** Per-request headers, merged before the global `prepareHeaders` hook. */
  headers?: Record<string, string> | Headers;
  /** Optional runtime validation applied to a 2xx body. */
  decoder?: Decoder<T>;
  /** Overrides the default request timeout (`API_TIMEOUT_MS`) for this request. */
  timeoutMs?: number;
  /** Skip reading a 2xx response body entirely: resolves ok with
   *  `data: undefined` and any `decoder` is not invoked. Non-2xx error bodies
   *  are still parsed. For endpoints whose success body is irrelevant or
   *  non-JSON. */
  ignoreBody?: boolean;
}

/** The non-throwing request core signature: always resolves to an
 *  {@link ApiResult}, never throws. */
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
