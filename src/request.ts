// The non-throwing core. requestRaw builds the request, performs the fetch via
// the configured layer, and ALWAYS resolves to an ApiResult<T> — every failure
// mode (network, timeout, cancellation, non-2xx, decode) is returned, never
// thrown. request() is the thin null-collapsing wrapper over it.
// ---------------------------------------------------------------------------

import { getFetchConfig } from "./config.js";
import { API_TIMEOUT_MS, withTimeout } from "./timeout.js";
import type { ApiErr, ApiResult, HttpMethod, RequestOptions } from "./types.js";

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
 * Classify a thrown error from the request pipeline into an ApiErr. Priority:
 *  1. caller signal already aborted → "cancelled" (status 0)
 *  2. DOMException TimeoutError / AbortError → "timeout" (status 0)
 *  3. everything else (TypeError, header-prep throw, body-read failure) →
 *     "network" (status 0)
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

/** Parse a non-2xx response body, lifting error / code / request_id fields. */
async function parseErrorResponse(res: Response): Promise<ApiErr> {
  let error = `HTTP ${res.status}`;
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
  return makeErr(res.status, error, code, requestId);
}

/**
 * The non-throwing request core. Builds headers (JSON-encoding the body for
 * non-GET requests), runs the global `prepareHeaders` hook, composes the
 * timeout signal, resolves the URL, performs the fetch, and returns an
 * {@link ApiResult}. Never throws — every failure is a returned {@link ApiErr}.
 */
export async function requestRaw<T>(
  method: HttpMethod,
  path: string,
  opts?: RequestOptions<T>,
): Promise<ApiResult<T>> {
  const cfg = getFetchConfig();
  const callerSignal = opts?.signal;

  try {
    const init: RequestInit = { method };

    const headers = new Headers();
    if (method !== "GET" && opts?.body !== undefined) {
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

    const url = joinUrl(cfg.baseUrl, path);
    const fetchImpl = cfg.fetchFn ?? fetch;

    const res = await fetchImpl(url, init);

    if (!res.ok) {
      return await parseErrorResponse(res);
    }
    if (res.status === 204) {
      return { ok: true, status: res.status, data: undefined as T };
    }

    const text = await res.text();
    if (text === "") {
      return { ok: true, status: res.status, data: undefined as T };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return makeErr(res.status, `response not JSON: ${errMsg(e)}`, "decode");
    }

    if (opts?.decoder !== undefined) {
      try {
        return { ok: true, status: res.status, data: opts.decoder(parsed) };
      } catch (e) {
        return makeErr(res.status, `response shape mismatch: ${errMsg(e)}`, "decode");
      }
    }

    return { ok: true, status: res.status, data: parsed as T };
  } catch (e) {
    return classifyThrown(e, callerSignal);
  }
}

/**
 * Convenience wrapper over {@link requestRaw}: returns the decoded data on a
 * successful result, or `null` on any error. Prefer {@link requestRaw} when you
 * need the status code or error details.
 */
export async function request<T>(
  method: HttpMethod,
  path: string,
  opts?: RequestOptions<T>,
): Promise<T | null> {
  const result = await requestRaw<T>(method, path, opts);
  return result.ok ? result.data : null;
}
