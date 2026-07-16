// The non-throwing core. requestRaw builds the request, performs the fetch via
// the instance's config, and ALWAYS resolves to an ApiResult<T> — every
// failure mode (invalid, network, timeout, cancellation, non-2xx, decode) is
// returned, never thrown. request() is the thin null-collapsing wrapper over
// it. makeRequestRaw/makeRequest are the config-parametrized factories, bound
// to an immutable per-instance config in instance.ts.
// ---------------------------------------------------------------------------

import type { FetchConfig } from "./types.js";
import { API_TIMEOUT_MS, withTimeout } from "./timeout.js";
import type {
  ApiErr,
  ApiResult,
  HttpMethod,
  RequestFn,
  RequestOptions,
  RequestRawFn,
} from "./types.js";

const JSON_CT = "application/json";

/** Extract a human-readable message from an unknown thrown value without
 *  risking a `[object Object]` stringification. */
function errMsg(e: unknown): string {
  if (e instanceof Error || e instanceof DOMException) {
    return e.message;
  }
  if (typeof e === "string") {
    return e;
  }
  return "unknown error";
}

/** Narrow an unknown parsed body to an indexable object. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Build an ApiErr, omitting optional fields when absent (exactOptionalPropertyTypes).
 *  `headers` is passed only where a real HTTP response exists (non-2xx or a
 *  2xx decode failure), per the ApiErr.headers contract. */
function makeErr(
  status: number,
  error: string,
  code?: string,
  requestId?: string,
  headers?: Headers,
): ApiErr {
  const err: {
    ok: false;
    status: number;
    error: string;
    code?: string;
    requestId?: string;
    headers?: Headers;
  } = {
    ok: false,
    status,
    error,
  };
  if (code !== undefined) {
    err.code = code;
  }
  if (requestId !== undefined) {
    err.requestId = requestId;
  }
  if (headers !== undefined) {
    err.headers = headers;
  }
  return err;
}

/** Coerce a possibly-non-numeric status (a custom fetchFn may return a
 *  malformed object) to a number, defaulting to 0. */
function statusOf(res: Response): number {
  return typeof res.status === "number" ? res.status : 0;
}

/**
 * Neutralize a relative path's parser-significant navigation syntax before it
 * is concatenated onto a base URL, so a crafted path cannot escape the base
 * path prefix via URL normalization. A leading slash is ensured, backslashes
 * (special-scheme URL parsing treats `\` as `/`) are percent-encoded, the
 * ASCII TAB / LF / CR the WHATWG URL parser strips outright (else two dots
 * astride a stripped char could fuse into a live `..` after the guard) are
 * percent-encoded (`%09` / `%0A` / `%0D`) in the path part only, and any
 * dot-segment — `.` / `..` and the percent-encoded equivalents (`%2e`,
 * `%2e%2e`, `.%2e`, …) the WHATWG URL parser would otherwise pop — is
 * double-encoded so it survives normalization as opaque path data. The dots
 * become `%252E`, not `%2E`, on purpose: `%2E`/`%2e` is still recognized as a
 * dot octet and would be popped.
 */
function safeSuffix(path: string): string {
  // Isolate the query (`?`) / fragment (`#`) before segment processing: the
  // URL parser does not path-normalize them and they must reach the server
  // verbatim. Folding them into the path both missed a `..`/`.` adjacent to
  // `?`/`#` (a live navigation operator that escaped the base path prefix) and
  // double-encoded dot-segments inside query values, corrupting them.
  const marks = [path.indexOf("?"), path.indexOf("#")].filter((i) => i !== -1);
  const sep = marks.length > 0 ? Math.min(...marks) : -1;
  const pathPart = sep === -1 ? path : path.slice(0, sep);
  const rest = sep === -1 ? "" : path.slice(sep);
  const raw = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  const encoded = raw
    .replace(/\\/g, "%5C")
    .replace(/\t/g, "%09")
    .replace(/\n/g, "%0A")
    .replace(/\r/g, "%0D")
    .split("/")
    .map((segment) => {
      const dotLike = segment.replace(/%2e/gi, ".");
      if (dotLike === "." || dotLike === "..") {
        return segment.replace(/\./g, "%2E").replace(/%/g, "%25");
      }
      return segment;
    })
    .join("/");
  return encoded + rest;
}

/**
 * Join a base URL with a relative path per the relative-path contract:
 * strip a trailing slash from the base, then append the path via
 * {@link safeSuffix}, which ensures a single leading slash and preserves the
 * base path prefix against dot-segment / backslash navigation. With no base,
 * the path is returned verbatim.
 */
function joinUrl(baseUrl: string | undefined, path: string): string {
  if (baseUrl === undefined) {
    return path;
  }
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}${safeSuffix(path)}`;
}

/** Merge caller-supplied headers (object or Headers) into the target. */
function mergeHeaders(target: Headers, source: Record<string, string> | Headers | undefined): void {
  if (source === undefined) {
    return;
  }
  if (source instanceof Headers) {
    source.forEach((value, key) => {
      target.set(key, value);
    });
    return;
  }
  for (const [key, value] of Object.entries(source)) {
    target.set(key, value);
  }
}

/** The caller-aborted-wins envelope shared by both classifiers, so the
 *  cancelled status/message/code stay defined in exactly one place. */
function cancelledErr(): ApiErr {
  return makeErr(0, "request cancelled", "cancelled");
}

/**
 * Classify a throw from the BUILD phase (header construction, JSON body
 * encoding, the `prepareHeaders` hook, timeout composition, url join) into an
 * ApiErr. A caller that already aborted ⇒ "cancelled"; every other build
 * failure is a client-side "invalid" request — it never reached the network,
 * so classifying it as "network" would be a misdiagnosis.
 */
function classifyBuildError(e: unknown, callerSignal: AbortSignal | undefined): ApiErr {
  if (callerSignal?.aborted === true) {
    return cancelledErr();
  }
  return makeErr(0, errMsg(e), "invalid");
}

/**
 * Classify a thrown error from the FETCH / response-read phase into an ApiErr.
 * Priority:
 *  1. caller signal already aborted → "cancelled" (status 0)
 *  2. DOMException TimeoutError / AbortError → "timeout" (status 0)
 *  3. everything else (TypeError, a malformed result from a custom fetchFn, a
 *     mid-body read failure) → "network" (status 0)
 */
function classifyThrown(e: unknown, callerSignal: AbortSignal | undefined): ApiErr {
  if (callerSignal?.aborted === true) {
    return cancelledErr();
  }
  if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) {
    return makeErr(0, e.message, "timeout");
  }
  return makeErr(0, errMsg(e), "network");
}

/** Read a response body as text, optionally bounded to `max` bytes. When `max`
 *  is undefined the read is unbounded (byte-identical to `res.text()`, the
 *  default). When set, a `content-length` over the cap is rejected up front and
 *  the streamed body is aborted the moment it exceeds the cap, so an untrusted
 *  upstream (the documented SSR/Node path) cannot force unbounded buffering. */
async function readBounded(res: Response, max: number | undefined): Promise<string> {
  if (max === undefined) {
    return res.text();
  }
  const contentLength = res.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > max) {
    throw new Error(`response exceeds ${max} bytes`);
  }
  const body = res.body;
  if (body === null) {
    return res.text();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    total += result.value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error(`response exceeds ${max} bytes`);
    }
    chunks.push(result.value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

/** Parse a non-2xx response body, lifting error / code / request_id fields.
 *  `res.status` is coerced to a number: a custom `fetchFn` may return a truthy
 *  non-Response whose `status` is undefined, and `ApiErr.status` is `number`.
 *  `max` bounds the body read (see {@link readBounded}); undefined = unbounded. */
async function parseErrorResponse(res: Response, max: number | undefined): Promise<ApiErr> {
  const status = statusOf(res);
  let error = `HTTP ${status}`;
  let code: string | undefined;
  let requestId: string | undefined;
  try {
    const body: unknown = JSON.parse(await readBounded(res, max));
    if (isRecord(body)) {
      const errField = body["error"];
      if (typeof errField === "string") {
        error = errField;
      }
      const codeField = body["code"];
      if (typeof codeField === "string") {
        code = codeField;
      }
      const ridField = body["request_id"] ?? body["requestId"];
      if (typeof ridField === "string") {
        requestId = ridField;
      }
    }
  } catch {
    // Non-JSON / empty error body — keep the `HTTP <status>` fallback.
  }
  return makeErr(status, error, code, requestId, res.headers);
}

/**
 * Build the non-throwing request core bound to an immutable config. The config
 * is captured once at instance construction ({@link createFetch}); a changed
 * backend produces a new instance.
 */
export function makeRequestRaw(cfg: FetchConfig): RequestRawFn {
  return async function requestRaw<T>(
    method: HttpMethod,
    path: string,
    opts?: RequestOptions<T>,
  ): Promise<ApiResult<T>> {
    let callerSignal: AbortSignal | undefined;

    // --- Build phase ------------------------------------------------------
    // Header construction, JSON body encoding, the prepareHeaders hook, timeout
    // composition, and url join. A throw here is a client-side "invalid"
    // request (or "cancelled" if the caller already aborted) — never hit the
    // network.
    const init: RequestInit = { method };
    let url: string;
    try {
      callerSignal = opts?.signal;
      const headers = new Headers();
      // A null / undefined body means "no body": send neither payload nor a
      // Content-Type (POSTing a literal JSON `null` is a non-need).
      if (method !== "GET" && opts?.body != null) {
        const encoded = JSON.stringify(opts.body) as string | undefined;
        if (encoded === undefined) {
          throw new TypeError("request body is not JSON-encodable");
        }
        headers.set("Content-Type", JSON_CT);
        init.body = encoded;
      }
      mergeHeaders(headers, opts?.headers);

      let effectiveHeaders = headers;
      if (cfg.prepareHeaders !== undefined) {
        const prepared = await cfg.prepareHeaders(headers);
        if (prepared !== undefined) {
          effectiveHeaders = prepared;
        }
      }
      init.headers = effectiveHeaders;

      if (cfg.credentials !== undefined) {
        init.credentials = cfg.credentials;
      }

      init.signal = withTimeout(callerSignal, opts?.timeoutMs ?? API_TIMEOUT_MS);
      url = joinUrl(cfg.baseUrl, path);
    } catch (e) {
      return classifyBuildError(e, callerSignal);
    }

    // --- Fetch phase ------------------------------------------------------
    // A throw here is a genuine network / timeout / cancellation failure.
    let res: Response;
    try {
      const fetchImpl = cfg.fetchFn ?? fetch;
      res = await fetchImpl(url, init);
    } catch (e) {
      return classifyThrown(e, callerSignal);
    }

    // --- Response phase ---------------------------------------------------
    // Interpret the result. The outer try preserves the never-throw guarantee
    // for a malformed result from a custom fetchFn (e.g. null) and for a
    // mid-body read failure — both are network-class. A JSON.parse / decoder
    // throw is a "decode" error, handled by its own inner try before it can
    // reach here.
    try {
      if (!res.ok) {
        return await parseErrorResponse(res, cfg.maxResponseBytes);
      }
      const status = statusOf(res);
      if (status === 204) {
        return { ok: true, status, data: undefined as T };
      }

      if (opts?.ignoreBody === true) {
        // Caller declared the success body irrelevant: skip the read and the
        // decoder entirely. Cancel the unread stream so the connection is
        // released (best-effort; a null body or a locked stream is fine).
        try {
          await res.body?.cancel();
        } catch {
          // Releasing the unread body is best-effort.
        }
        return { ok: true, status, data: undefined as T };
      }

      const text = await readBounded(res, cfg.maxResponseBytes);
      if (text === "") {
        return { ok: true, status, data: undefined as T };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        return makeErr(status, `response not JSON: ${errMsg(e)}`, "decode", undefined, res.headers);
      }

      if (opts?.decoder !== undefined) {
        try {
          return { ok: true, status, data: opts.decoder(parsed) };
        } catch (e) {
          return makeErr(
            status,
            `response shape mismatch: ${errMsg(e)}`,
            "decode",
            undefined,
            res.headers,
          );
        }
      }

      return { ok: true, status, data: parsed as T };
    } catch (e) {
      return classifyThrown(e, callerSignal);
    }
  };
}

/**
 * Build a null-collapsing `request` over a `requestRaw`: the decoded data on a
 * successful result, or `null` on any error. Prefer the raw form when you need
 * the status code or error details.
 */
export function makeRequest(raw: RequestRawFn): RequestFn {
  return async function request<T>(
    method: HttpMethod,
    path: string,
    opts?: RequestOptions<T>,
  ): Promise<T | null> {
    const result = await raw<T>(method, path, opts);
    // Collapse a truly-empty body (204 / empty ⇒ data === undefined) to null. A
    // JSON `null` / `0` / `false` / `""` body is real data and passes through.
    return result.ok && result.data !== undefined ? result.data : null;
  };
}
