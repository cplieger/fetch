# fetch

[![npm](https://img.shields.io/npm/v/@cplieger/fetch)](https://www.npmjs.com/package/@cplieger/fetch)
[![JSR](https://jsr.io/badges/@cplieger/fetch)](https://jsr.io/@cplieger/fetch)
[![Test coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/cplieger/fetch/badges/coverage.json)](https://github.com/cplieger/fetch/actions/workflows/coverage.yml)
[![Mutation (TS)](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/cplieger/fetch/badges/mutation-ts.json)](https://github.com/cplieger/fetch/issues?q=label%3Astryker-tracker)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/13488/badge)](https://www.bestpractices.dev/projects/13488)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/cplieger/fetch/badge)](https://scorecard.dev/viewer/?uri=github.com/cplieger/fetch)

> Small, zero-dependency universal fetch wrapper with a typed, non-throwing result envelope.

A standalone TypeScript wrapper around the platform `fetch`. The core never throws: every request resolves to an `ApiResult<T>` — a discriminated union of a success envelope (`{ ok: true, status, data }`) and an error envelope (`{ ok: false, status, error, code?, requestId?, headers? }`) — so network failures, timeouts, cancellations, non-2xx responses, and decode errors are all values you branch on rather than exceptions you catch. On top of the core sit thin per-verb helpers: a null-collapsing form (`apiGet` → `data | null`), a full-envelope form (`apiGetRaw` → `ApiResult`), and a decoder-validated form (`apiGetTyped`). Base URL, credentials, a header-preparation hook, and a custom fetch implementation are captured immutably per instance by `createFetch` — the only configuration surface; there is no module-global state. Zero runtime dependencies, ESM-only, published as TypeScript source.

`@cplieger/fetch` is the browser-side JSON-fetch primitive in the toolkit: it is the inbound-shaped counterpart to [`httpx`](https://github.com/cplieger/httpx) (the resilient _outbound_ HTTP library for Go), and it composes cleanly under [`@cplieger/actions`](https://github.com/cplieger/actions) (which owns retry, dedupe, optimistic updates, and notification wiring). It deliberately owns only the request/response envelope — see [Unsupported by design](#unsupported-by-design).

## Install

```sh
npx jsr add @cplieger/fetch
# or
npm i @cplieger/fetch
```

Requires TypeScript ≥ 5.0 and a bundler that supports ESM.

## Usage

Create an instance once at boot (one line in a shared module), then call its verb helpers:

```typescript
import { createFetch } from "@cplieger/fetch";

export const api = createFetch({
  baseUrl: "https://api.example.com/v1",
  credentials: "include",
  prepareHeaders: (headers) => {
    // Runs per request — read late-bound state (a token set after boot) here.
    headers.set("Authorization", `Bearer ${getToken()}`);
  },
});

// Null-collapsing: the decoded body on success, null on any error.
const user = await api.apiGet<{ id: string; name: string }>("/users/me");
if (user) {
  console.log(user.name);
}

// Create a resource with a JSON body.
const created = await api.apiPost<{ id: string }>("/items", { name: "widget" });
```

Config is shallow-copied and frozen at construction. There is no post-construction mutation and no module-global default: a changed backend produces a new instance, and per-request state (tokens, tracing headers) flows through the `prepareHeaders` hook or per-request `headers`.

### The result envelope

When you need the status code or the error details, reach for the `*Raw` helpers (or `requestRaw` directly). They resolve to an `ApiResult<T>` and never throw:

```typescript
const res = await api.apiGetRaw<{ id: string }>("/users/me");
if (res.ok) {
  console.log(res.status, res.data);
} else {
  // res.status is the HTTP status, or 0 for a network / timeout / cancelled /
  // invalid failure.
  // res.code is one of "network" | "timeout" | "cancelled" | "decode" |
  // "invalid", or a server-supplied code lifted from the error body.
  console.error(res.status, res.code, res.error, res.requestId);
  // res.headers carries the response headers whenever a real HTTP response
  // was received (any non-2xx, or a 2xx decode failure) — e.g. Retry-After:
  if (res.status === 429) {
    console.warn("retry after", res.headers?.get("Retry-After"));
  }
}
```

> On a 204 or empty-body 2xx response, a success envelope carries `data: undefined`. The null-collapsing helpers (`request` / `apiGet` / …) turn that into `null`; when you use the `*Raw` helpers on a 204-capable endpoint, type `T` to include `undefined` (or branch on `status`). A JSON `null` / `0` / `false` / `""` body is real data and passes through unchanged.
>
> `code: "invalid"` marks a **client-side** build failure — an un-encodable body (circular / BigInt), a bad header name/value, a bad `timeoutMs`, or a throwing `prepareHeaders` — that never reached the network, so it is reported distinctly from `"network"`.

### Runtime validation

Pass a `Decoder<T>` — a function that returns the typed value or throws — to validate a 2xx body. A decoder throw becomes an `ApiErr` with `code: "decode"` (or `null` via the `*Typed` helpers):

```typescript
import { type Decoder } from "@cplieger/fetch";

const decodeUser: Decoder<{ id: string }> = (v) => {
  if (typeof v !== "object" || v === null || typeof (v as { id?: unknown }).id !== "string") {
    throw new Error("expected { id: string }");
  }
  return v as { id: string };
};

const user = await api.apiGetTyped("/users/me", decodeUser); // { id: string } | null
```

### Per-request options

Every helper accepts a trailing `RequestOptions`: a caller `AbortSignal`, per-request `headers`, a `decoder`, a `timeoutMs` override (default 30 000 ms), and `ignoreBody`. The caller signal is composed with the request timeout, so whichever fires first aborts the request. The timeout covers the network round-trip only — the instance's `prepareHeaders` hook runs **before** the fetch and is **not** bounded by it, so a hook that may hang (e.g. an async token refresh) must self-bound.

```typescript
const controller = new AbortController();
const res = await api.apiGetRaw("/slow", {
  signal: controller.signal,
  timeoutMs: 5_000,
  headers: { "X-Request-Id": crypto.randomUUID() },
});

// ignoreBody: skip reading a 2xx success body entirely (data: undefined; a
// supplied decoder is not invoked). Non-2xx error bodies are still parsed.
// For endpoints whose success body is irrelevant or non-JSON.
await api.apiDeleteRaw("/items/1", { ignoreBody: true });
```

> **Path contract:** `path` is expected to be a **relative** path. With `baseUrl` set, the configured scheme+host always precede it, so an absolute (`https://…`) or protocol-relative (`//host`) path is neutralised (kept as a path segment) and cannot override the origin. A relative `path` also cannot escape the configured base path via `..` / dot-segment or backslash navigation — those are percent-encoded so the base path prefix always stands, while the query string and fragment are preserved verbatim. For this origin-override protection to hold, `baseUrl` must be an **absolute** URL (scheme + host); an empty or relative `baseUrl` does not neutralise a protocol-relative `path`. With `baseUrl` **unset**, `path` is passed to `fetch()` verbatim — the caller owns the full URL and must never pass untrusted input as the whole path.
>
> _Design note — neutralize, not reject (considered and declined):_ returning a pre-network `code: "invalid"` for navigation syntax instead of neutralizing it was evaluated and declined. The documented leading-slash-relative-to-base rule deliberately differs from WHATWG resolution (where `/users` means origin-root), so a parser-based validate-and-reject must hand-maintain the same invariant set this contract already encodes — with mistakes surfacing as false rejections of correct requests instead of today's fail-safe neutralized send. Neutralize-and-forward stays the contract.

### Multiple backends

Instances are cheap and fully isolated — one per origin / credential-set / tenant, or one per request for SSR. Two instances share nothing:

```typescript
import { createFetch } from "@cplieger/fetch";

const tenantA = createFetch({ baseUrl: "https://a.example.com", credentials: "include" });
const tenantB = createFetch({ baseUrl: "https://b.example.com" });

const [a, b] = await Promise.all([tenantA.apiGet<User>("/me"), tenantB.apiGet<User>("/me")]);
```

A changed backend produces a new instance (`api = createFetch(nextConfig)`); state that varies per request (an auth token acquired after boot, tracing headers) reads from inside `prepareHeaders`, which runs on every call.

## API

### Instance factory

- `createFetch(config?)` — build an isolated fetch instance. `config` (`baseUrl`, `credentials`, `prepareHeaders`, `fetchFn`, `maxResponseBytes`) is shallow-copied and frozen at construction; there is no post-construction mutation and no module-global default. Returns a `FetchInstance` exposing `requestRaw`, `request`, and all twelve verb helpers.
- `FetchConfig` — the configuration shape.
- `FetchInstance` — the instance shape.

> `maxResponseBytes` is an opt-in cap on the response body size (unset = unlimited, the default). When set, a response whose `content-length` exceeds it — or whose streamed body grows past it — is rejected rather than buffered, a defense-in-depth guard against a hostile upstream (e.g. the SSR / Node path). An over-cap 2xx body surfaces as `code: "network"` (status 0); an over-cap error body falls back to the `HTTP <status>` message.

### Request core (per instance)

- `requestRaw<T>(method, path, opts?)` — the non-throwing core; resolves to `ApiResult<T>`.
- `request<T>(method, path, opts?)` — null-collapsing wrapper: `data` on success, `null` on any error.

### Verb helpers (per instance)

- `apiGet` / `apiPost` / `apiPut` / `apiPatch` / `apiDelete` — null-collapsing (`Promise<T | null>`).
- `apiGetRaw` / `apiPostRaw` / `apiPutRaw` / `apiPatchRaw` / `apiDeleteRaw` — full envelope (`Promise<ApiResult<T>>`).
- `apiGetTyped` / `apiPostTyped` — decoder-validated, null-collapsing.

> Decoder validation on `apiPut` / `apiPatch` / `apiDelete` (and their `*Raw` forms) is available via the `decoder` option — e.g. `apiPut(path, body, { decoder })` — rather than dedicated `*Typed` helpers.

### Timeout

- `withTimeout(signal, ms)` — compose an optional caller signal with a fresh timeout signal (via `AbortSignal.any` when available).
- `API_TIMEOUT_MS` — default request timeout (30 000 ms).

> **Runtime baseline:** `AbortSignal.timeout` is required (Chrome 103 / Safari 16 / Firefox 100 / Node 18+). Composing a caller signal with the timeout additionally needs `AbortSignal.any` (Chrome 116 / Safari 17.4 / Firefox 124 / Node 20.3+); on a runtime without it, `withTimeout` degrades to timeout-only (the caller signal is dropped, the timeout still applies) rather than failing to build the request.

### Types

- `ApiOk<T>` / `ApiErr` / `ApiResult<T>` — the result envelope union. `ApiErr.headers` carries the response headers whenever a real HTTP response was received (any non-2xx, or a 2xx decode failure); it is absent on network / timeout / cancelled / invalid failures.
- `Decoder<T>` — a runtime validator: returns the typed value or throws.
- `HttpMethod` — `"GET" | "POST" | "PUT" | "PATCH" | "DELETE"`.
- `RequestOptions<T>` — per-request `body`, `signal`, `headers`, `decoder`, `timeoutMs`, `ignoreBody`.

## Migrating from v1

v2 removes the module-global config surface; instances are the only topology, and their config is immutable. Mechanical mapping:

| v1                                                | v2                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| `configureFetch(cfg)` + top-level `apiGet` / …    | `export const api = createFetch(cfg)` + `api.apiGet` / …                  |
| `instance.configure(cfg)` (shallow-merge)         | `createFetch({ ...oldCfg, ...cfg })` — a new instance (replace semantics) |
| Late-bound token via a later `configure` call     | Read the token inside `prepareHeaders` (runs per request)                 |
| `resetFetchConfig()` / `getFetchConfig()` (tests) | Build a fresh instance per test — nothing global to reset                 |

The envelope, verb helpers, path contract, timeout composition, and decoder seam are unchanged. New in v2: `ApiErr.headers` (error-response headers) and `RequestOptions.ignoreBody` (skip a 2xx body).

## Unsupported by design

These features are intentionally out of scope. `@cplieger/fetch` is the request/response envelope, nothing more:

| Feature                                                      | Reason                                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retries / backoff                                            | A dispatch-lifecycle concern. Compose with [`@cplieger/actions`](https://github.com/cplieger/actions) or a retry helper.                                                                                                                              |
| Idempotency-key / `X-Request-ID` injection                   | The caller passes these per request via `opts.headers` (or a global `prepareHeaders` hook).                                                                                                                                                           |
| Interceptor / middleware chains                              | The single `prepareHeaders` seam plus `fetchFn` injection cover the real cases without a plugin pipeline.                                                                                                                                             |
| Decoder combinators                                          | Ships only the `Decoder<T>` type and the optional invocation seam. Each app keeps its own validators (hand-written, zod, valibot, …).                                                                                                                 |
| Response caching / revalidation                              | Out of paradigm — this is a fetch envelope, not a data cache.                                                                                                                                                                                         |
| Mutable / module-global configuration                        | Config is frozen at `createFetch`. A changed backend is a new instance; late-bound per-request state reads from inside `prepareHeaders`.                                                                                                              |
| Non-JSON bodies / raw `Response` / success-response metadata | JSON-envelope by design: the request body is JSON-encoded and the response is read as JSON (or empty). Error-path headers ride `ApiErr.headers`; for binary / streaming bodies, success-response header access, or `statusText`, drop to raw `fetch`. |

## Disclaimer

This project is built with care and follows security best practices, but it is intended for personal / self-hosted use. No guarantees of fitness for production environments. Use at your own risk.

This project was built with AI-assisted tooling using [Claude Opus](https://www.anthropic.com/claude) and [Kiro](https://kiro.dev). The human maintainer defines architecture, supervises implementation, and makes all final decisions.

## License

GPL-3.0 — see [LICENSE](LICENSE).
