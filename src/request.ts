// The non-throwing core. requestRaw builds the request, performs the fetch via
// the resolved config layer, and ALWAYS resolves to an ApiResult<T> — every
// failure mode (invalid, network, timeout, cancellation, non-2xx, decode) is
// returned, never thrown. request() is the thin null-collapsing wrapper over
// it. makeRequestRaw/makeRequest bind a config source (the module-global
// default, or a per-instance store from createFetch); the exported requestRaw/
// request are the default-instance bindings.
// ---------------------------------------------------------------------------

import { getFetchConfig } from "./config.js";
import type { FetchConfig } from "./config.js";
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
  if (e instanceof Error) {
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

/** Build an ApiErr, omitting optional fields when absent (exactOptionalPropertyTypes). */
function makeErr(status: number, error: string, code?: string, requestId?: string): ApiErr {
  const err: { ok: false; status: number; error: string; code?: string; requestId?: string } = {
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
  return err;
}

/**
 * Join a base URL with a relative path per the relative-path contract:
 * strip a trailing slash from the base, ensure a single leading slash on the
 * path. With no base, the path is returned verbatim.
 */
function joinUrl(baseUrl: string | undefined, path: string): string {
  if (baseUrl === undefined) {
    return path;
  }
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
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

/**
 * Classify a throw from the BUILD phase (header construction, JSON body
 * encoding, the `prepareHeaders` hook, timeout composition, url join) into an
 * ApiErr. A caller that already aborted ⇒ "cancelled"; every other build
 * failure is a client-side "invalid" request — it never reached the network,
 * so classifying it as "network" would be a misdiagnosis.
 */
function classifyBuildError(e: unknown, callerSignal: AbortSignal | undefined): ApiErr {
  if (callerSignal?.aborted === true) {
    return makeErr(0, "request cancelled", "cancelled");
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
    return makeErr(0, "request cancelled", "cancelled");
  }
  if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) {
    return makeErr(0, e.message, "timeout");
  }
  return makeErr(0, errMsg(e), "network");
}

/** Parse a non-2xx response body, lifting error / code / request_id fields.
 *  `res.status` is coerced to a number: a custom `fetchFn` may return a truthy
 *  non-Response whose `status` is undefined, and `ApiErr.status` is `number`. */
async function parseErrorResponse(res: Response): Promise<ApiErr> {
  const status = typeof res.status === "number" ? res.status : 0;
  let error = `HTTP ${status}`;
  let code: string | undefined;
  let requestId: string | undefined;
  try {
    const body: unknown = await res.json();
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
  return makeErr(status, error, code, requestId);
}

/**
 * Build the non-throwing request core bound to a config source. `getConfig` is
 * called at the START of every request, so a `configure`/`configureFetch` that
 * runs after the instance is created is reflected on the next call.
 */
export function makeRequestRaw(getConfig: () => FetchConfig): RequestRawFn {
  return async function requestRaw<T>(
    method: HttpMethod,
    path: string,
    opts?: RequestOptions<T>,
  ): Promise<ApiResult<T>> {
    const cfg = getConfig();
    const callerSignal = opts?.signal;

    // --- Build phase ------------------------------------------------------
    // Header construction, JSON body encoding, the prepareHeaders hook, timeout
    // composition, and url join. A throw here is a client-side "invalid"
    // request (or "cancelled" if the caller already aborted) — never hit the
    // network.
    const init: RequestInit = { method };
    let url: string;
    try {
      const headers = new Headers();
      // A null / undefined body means "no body": send neither payload nor a
      // Content-Type (POSTing a literal JSON `null` is a non-need).
      if (method !== "GET" && opts?.body != null) {
        headers.set("Content-Type", JSON_CT);
        init.body = JSON.stringify(opts.body);
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
    const fetchImpl = cfg.fetchFn ?? fetch;
    let res: Response;
    try {
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
        return await parseErrorResponse(res);
      }
      const status = typeof res.status === "number" ? res.status : 0;
      if (status === 204) {
        return { ok: true, status, data: undefined as T };
      }

      const text = await res.text();
      if (text === "") {
        return { ok: true, status, data: undefined as T };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        return makeErr(status, `response not JSON: ${errMsg(e)}`, "decode");
      }

      if (opts?.decoder !== undefined) {
        try {
          return { ok: true, status, data: opts.decoder(parsed) };
        } catch (e) {
          return makeErr(status, `response shape mismatch: ${errMsg(e)}`, "decode");
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

// --- Default instance (bound to the module-global config store) ------------
// The byte-compatible existing surface: these read the config that
// configureFetch / resetFetchConfig mutate.

/** The default-instance non-throwing request core. See {@link makeRequestRaw}. */
export const requestRaw: RequestRawFn = makeRequestRaw(getFetchConfig);

/** The default-instance null-collapsing request. See {@link makeRequest}. */
export const request: RequestFn = makeRequest(requestRaw);
