# Requests, timeouts and runtimes

This page covers how to set up an instance and shape each request, for a developer wiring the library into an app. It also lists the runtime versions the library needs.

## Instance settings

`createFetch(config?)` copies the settings and freezes them, so nothing changes them later. It returns a `FetchInstance` with `requestRaw`, `request` and the twelve verb helpers.

| Key | Default | Description |
| --- | --- | --- |
| `baseUrl` | _(unset)_ | Put before every path. Must be an absolute URL for the [path rules](security-model.md#paths-and-base-urls) to hold |
| `credentials` | _(unset)_ | The `RequestInit.credentials` mode for every request, such as `"include"` for cookies |
| `prepareHeaders` | _(unset)_ | A hook that sets headers on every request. See below |
| `fetchFn` | the global `fetch` | Another `fetch` implementation, for server-side rendering or tests |
| `maxResponseBytes` | _(unset)_, no limit | A cap on the response body size. See [the size cap](security-model.md#response-size-cap) |

## One instance per backend

Instances are cheap and share nothing. Create one per origin, credential set or tenant, or one per request in server-side rendering:

```typescript
import { createFetch } from "@cplieger/fetch";

const tenantA = createFetch({ baseUrl: "https://a.example.com", credentials: "include" });
const tenantB = createFetch({ baseUrl: "https://b.example.com" });

const [a, b] = await Promise.all([tenantA.apiGet<User>("/me"), tenantB.apiGet<User>("/me")]);
```

To change a setting, create a new instance, for example `createFetch({ ...oldConfig, ...changes })`. In tests, create a fresh instance with a stub `fetchFn` for each test. There is no global state to reset.

## Headers per request

`prepareHeaders` runs on every request, after the request's own `headers` are merged in, so its values win. Read state that changes after startup, such as a token, inside the hook. The hook can change the `Headers` it receives, or return a new `Headers` object, which then replaces them. It can be `async`. If it throws, the request fails with `code: "invalid"` and nothing is sent.

The request timeout starts after the hook returns, so it does not bound the hook. A hook that can hang, such as a token refresh over the network, needs its own time limit.

## Request options

Every helper takes a last `RequestOptions` argument. The `apiPost`, `apiPut` and `apiPatch` helpers take the body as their second argument.

| Option | Description |
| --- | --- |
| `body` | Sent as JSON with `Content-Type: application/json`, on any method except GET |
| `rawBody` | A pre-encoded `BodyInit`, sent as it is on any method except GET, with no `Content-Type`. Set the type in `headers`. Not allowed with `body` |
| `signal` | Your `AbortSignal`, combined with the timeout |
| `headers` | A plain object or `Headers`, merged before `prepareHeaders` |
| `decoder` | Validates a 2xx body. See [Decoders](results.md#decoders) |
| `timeoutMs` | Overrides the 30,000 ms default for this request. Must be a finite number from 0 to `Number.MAX_SAFE_INTEGER` |
| `ignoreBody` | Skips reading a 2xx body. `data` is `undefined` and the decoder is not called. Error bodies are still read |

```typescript
const controller = new AbortController();
const res = await api.apiGetRaw("/slow", {
  signal: controller.signal,
  timeoutMs: 5_000,
  headers: { "X-Request-Id": crypto.randomUUID() },
});
```

## Timeouts

Each request has a timeout of `API_TIMEOUT_MS`, 30,000 ms, unless `timeoutMs` sets another. The timeout covers the request on the network, not the `prepareHeaders` hook. When you pass a `signal`, the library combines it with the timeout, and whichever fires first stops the request. Your abort gives `code: "cancelled"` and the timeout gives `code: "timeout"`.

`withTimeout(signal, ms)` is the function that combines them, exported for your own `fetch` calls.

## Runtimes

The library needs `AbortSignal.timeout`, which Chrome 103, Safari 16, Firefox 100 and Node 18 and later have. Combining your signal with the timeout also needs `AbortSignal.any`, which Chrome 116, Safari 17.4, Firefox 124 and Node 20.3 and later have. Without `AbortSignal.any`, `withTimeout` keeps the timeout and drops your signal, and the request is still sent.

The package is TypeScript source and ESM only. Your bundler compiles it, and it needs TypeScript 5.0 or later. The test suite runs in headless Chromium, against the browser's own `fetch`, `Headers`, `URL` and `AbortSignal`.

## Cookies and credentials

The `credentials` mode is set on a request only when the instance configures one, so an instance without it behaves the same on every runtime. It is passed to a custom `fetchFn` too.

A browser's `fetch` acts on it. Node's built-in `fetch` accepts the field and ignores it, attaching no cookies and raising no error, and a Workers runtime has no cookie store. So with the built-in `fetch` of Node or Workers, a cookie login set up with `credentials: "include"` stops working without an error. Server-rendered code that needs cookie auth can pass the incoming request's cookie in `headers`, or supply a `fetchFn` that manages cookies.
