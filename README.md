# fetch

[![npm](https://img.shields.io/npm/v/@cplieger/fetch)](https://www.npmjs.com/package/@cplieger/fetch) [![JSR](https://jsr.io/badges/@cplieger/fetch)](https://jsr.io/@cplieger/fetch) [![Mutation (TS)](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/cplieger/fetch/badges/mutation-ts.json)](https://github.com/cplieger/fetch/issues?q=label%3Astryker-tracker)

`@cplieger/fetch` wraps the platform `fetch` for TypeScript so JSON requests never throw. Each call returns a typed success or error value, or only the data or `null` when that is all you need.

It replaces the `try`/`catch`, the `response.ok` check and the `JSON.parse` you would otherwise write around each call. It has no runtime dependencies and ships as ESM-only TypeScript source, which your bundler compiles with your own code. It needs TypeScript 5.0 or later and runs on Node 18, Chrome 103, Safari 16 and Firefox 100 or later. It is licensed under Apache-2.0.

## Why use it

`@cplieger/fetch` is built for front-end and server-rendered code that calls a JSON API and wants to handle every failure in one `if`.

- A network failure, a timeout, a cancelled request, a non-2xx response and a body that fails validation all come back as an error value with a `code`.
- A failed response keeps its status, headers and parsed JSON body, so a 429's `Retry-After` is one property away.
- Validation is a plain function, so a zod or valibot schema plugs in as `(v) => schema.parse(v)`.
- With an absolute base URL, an absolute or protocol-relative path cannot reach another origin.
- It is about 2 kB minified and gzipped, and its tests run against Chromium's own `fetch`, `Headers` and `AbortSignal`.

Consider [ky](https://github.com/sindresorhus/ky) if you want retries, hooks and upload and download progress in one client. Consider [ofetch](https://github.com/unjs/ofetch) if you need binary or streamed responses and automatic retries on Node, browsers and workers.

## Install

```sh
npx jsr add @cplieger/fetch
# or
npm i @cplieger/fetch
```

## Usage

Create one instance per backend, then branch on the result:

```typescript
import { createFetch } from "@cplieger/fetch";

export const api = createFetch({ baseUrl: "https://api.example.com/v1" });

const res = await api.apiGetRaw<{ id: string; name: string }>("/users/me");
if (res.ok) {
  console.log(res.data.name, res.headers.get("ETag"));
} else {
  // status is 0 when no response arrived; code says why.
  console.error(res.status, res.code, res.error);
}
```

When you only need the data, the helpers without a suffix return it, or `null` on any error. `apiPost`, `apiPut` and `apiPatch` send their second argument as JSON with `Content-Type: application/json`:

```typescript
const user = await api.apiGet<{ id: string; name: string }>("/users/me"); // the user, or null
const created = await api.apiPost<{ id: string }>("/items", { name: "widget" });
```

Validate a response body with any function that returns the typed value or throws. A throw becomes an error with `code: "decode"`:

```typescript
import { z } from "zod";

const User = z.object({ id: z.string(), name: z.string() });
const user = await api.apiGetTyped("/users/me", (v) => User.parse(v)); // typed, or null
```

Every helper takes a last `options` argument for a cancel signal, a timeout, extra headers, a decoder, a pre-encoded body, or skipping the success body:

```typescript
const controller = new AbortController();
await api.apiGetRaw("/slow", { signal: controller.signal, timeoutMs: 5_000 });
await api.apiDeleteRaw("/items/1", { ignoreBody: true });
```

Put query parameters in the path, such as `/items?page=2`. To add a header that changes after startup, such as a token, read it inside the instance's `prepareHeaders` hook, which runs on every request. The timeout starts after `prepareHeaders` returns, so a hook that can hang needs its own limit. [Requests, timeouts and runtimes](docs/requests.md) covers every setting and option.

## API

- Instance: `createFetch(config?)` returns a `FetchInstance`. `FetchConfig` holds `baseUrl`, `credentials`, `prepareHeaders`, `fetchFn` and `maxResponseBytes`.
- Requests on an instance: `requestRaw` and `request`, plus `apiGet`, `apiPost`, `apiPut`, `apiPatch` and `apiDelete` in a plain form that returns the data or `null` and a `*Raw` form that returns the full result. `apiGetTyped` and `apiPostTyped` also take a decoder.
- Timeout: `withTimeout(signal, ms)` and `API_TIMEOUT_MS`, 30,000 ms.
- Types: `ApiOk<T>`, `ApiErr`, `ApiResult<T>`, `Decoder<T>`, `HttpMethod`, `RequestOptions<T>`.

The full reference is on [JSR](https://jsr.io/@cplieger/fetch/doc).

## Errors are values

`requestRaw` and every `*Raw` helper resolve to `ApiResult<T>` and never throw. A success is `{ ok: true, status, data, headers }`. An error is `{ ok: false, status, error, code?, requestId?, headers?, body? }`.

`status` is 0 when no response arrived. `code` is then `network`, `timeout`, `cancelled` or `invalid`, where `invalid` means the request could not be built and was never sent. A 2xx body that is not JSON or fails the decoder is `decode`, with the real status. A non-2xx response keeps its status and headers. When its body is JSON, `body` holds it, and its `error`, `code` and `request_id` fields fill the result's `error`, `code` and `requestId`.

The server controls `code` and can send `timeout` or another library code. A library code comes with `status` 0, or the 2xx status for `decode`, and a server code always comes with its non-2xx status. Treat `body` as untrusted input.

A 204 or an empty 2xx body gives `data: undefined`, which the plain helpers turn into `null`. A JSON `null`, `0`, `false` or `""` is real data.

[Results and errors](docs/results.md) has the full contract.

## Paths stay under your base URL

With an absolute `baseUrl`, every request goes to that scheme and host. A path such as `https://other.example` or `//host` becomes part of the path, so `https://api.example.com/v1` plus `https://other.example` requests `https://api.example.com/v1/https://other.example`. A `..`, a dot segment or a backslash cannot climb out of the base path, and the query string and fragment are sent as written.

The protection needs a `baseUrl` with a scheme and host. With an empty or relative `baseUrl`, a protocol-relative path can still reach another origin. With no `baseUrl`, the path goes to `fetch()` unchanged, so never pass untrusted input as the whole path.

[Base URLs and untrusted responses](docs/security-model.md) covers this and the response size cap.

## Unsupported by design

`@cplieger/fetch` has no retries or backoff, interceptor chains, response caching, decoder combinators, changeable or global settings, automatic idempotency-key or request-ID headers, or binary and streamed responses. [Unsupported by design](docs/non-goals.md) gives the reason for each and what to use instead.

## Related projects

- [@cplieger/actions](https://github.com/cplieger/actions) builds on this library and adds retry with backoff, request dedupe, optimistic updates and notifications.
- [httpx](https://github.com/cplieger/httpx) is the Go library for outbound HTTP calls, with retries and backoff built in.

## Documentation

- [Results and errors](docs/results.md) lists every result field, error code and empty-body rule.
- [Requests, timeouts and runtimes](docs/requests.md) covers instance settings, request options, timeouts and the runtime versions it needs.
- [Base URLs and untrusted responses](docs/security-model.md) explains the path rules, the response size cap and how to read server-controlled fields.
- [Unsupported by design](docs/non-goals.md) lists the features left out on purpose, with the reasons.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Disclaimer

This project is built with care and follows security best practices, but it is intended for personal / self-hosted use. No guarantees of fitness for production environments. Use at your own risk.

This project was built with AI-assisted tooling using [Claude](https://claude.com), [GPT](https://openai.com), and [Kiro](https://kiro.dev). The human maintainer defines architecture, supervises implementation, and makes all final decisions.

## License

Apache-2.0. See [LICENSE](LICENSE).
