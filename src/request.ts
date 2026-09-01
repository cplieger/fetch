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

/** Build an ApiErr, omitting optional fields when absent
 *  (exactOptionalPropertyTypes). `headers`/`body` are passed only where a real
 *  HTTP response exists, per the ApiErr contract. */
function makeErr(
  status: number,
  error: string,
  code?: string,
  requestId?: string,
  headers?: Headers,
  body?: unknown,
): ApiErr {
  const err: {
    ok: false;
    status: number;
    error: string;
    code?: string;
    requestId?: string;
    headers?: Headers;
    body?: unknown;
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
  if (body !== undefined) {
    err.body = body;
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
 * are percent-encoded, ASCII TAB / LF / CR (which the WHATWG URL parser strips
 * before a stripped char could fuse two dots into a live `..`) are
 * percent-encoded in the path part only, and any dot-segment — `.` / `..` and
 * percent-encoded equivalents — is double-encoded so it survives
 * normalization as opaque path data. The dots become `%252E`, not `%2E`: the
 * latter is still recognized as a dot octet and would be popped.
 */
function safeSuffix(path: string): string {
  // Query (`?`) / fragment (`#`) are isolated before segment processing: the
  // URL parser does not path-normalize them and they must reach the server
  // verbatim.
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
 * Join a base URL with a relative path: strip a trailing slash from the base,
 * then append the path via {@link safeSuffix}. With no base, the path is
 * returned verbatim.
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

/** The caller-aborted-wins envelope shared by both classifiers. */
function cancelledErr(): ApiErr {
  return makeErr(0, "request cancelled", "cancelled");
}

/**
 * Classify a throw from the BUILD phase (header construction, JSON body
 * encoding, `prepareHeaders`, timeout composition, url join). A caller that
 * already aborted classifies as "cancelled"; every other build failure is a
 * client-side "invalid" request — it never reached the network.
 */
function classifyBuildError(e: unknown, callerSignal: AbortSignal | undefined): ApiErr {
  if (callerSignal?.aborted === true) {
    return cancelledErr();
  }
  return makeErr(0, errMsg(e), "invalid");
}

/**
 * Classify a thrown error from the FETCH / response-read phase. Priority:
 * caller signal already aborted → "cancelled"; DOMException TimeoutError /
 * AbortError → "timeout"; everything else → "network".
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

/** Read a response body as text, optionally bounded to `max` bytes. When set,
 *  a `content-length` over the cap is rejected up front and the streamed body
 *  is aborted the moment it exceeds the cap, so an untrusted upstream cannot
 *  force unbounded buffering. */
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

/** Parse a non-2xx response body, lifting error / code / request_id fields. */
async function parseErrorResponse(res: Response, max: number | undefined): Promise<ApiErr> {
  const status = statusOf(res);
  let error = `HTTP ${status}`;
  let code: string | undefined;
  let requestId: string | undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBounded(res, max));
    if (isRecord(parsed)) {
      const errField = parsed["error"];
      if (typeof errField === "string") {
        error = errField;
      }
      const codeField = parsed["code"];
      if (typeof codeField === "string") {
        code = codeField;
      }
      const ridField = parsed["request_id"] ?? parsed["requestId"];
      if (typeof ridField === "string") {
        requestId = ridField;
      }
    }
  } catch {
    // Non-JSON / empty error body: keep the `HTTP <status>` fallback.
  }
  return makeErr(status, error, code, requestId, res.headers, parsed);
}

/**
 * Build the non-throwing request core bound to an immutable config, captured
 * once at instance construction ({@link createFetch}).
 */
export function makeRequestRaw(cfg: FetchConfig): RequestRawFn {
  return async function requestRaw<T>(
    method: HttpMethod,
    path: string,
    opts?: RequestOptions<T>,
  ): Promise<ApiResult<T>> {
    let callerSignal: AbortSignal | undefined;

    // --- Build phase ------------------------------------------------------
    // A throw here is a client-side "invalid" request (or "cancelled" if the
    // caller already aborted) — never hit the network.
    const init: RequestInit = { method };
    let url: string;
    try {
      callerSignal = opts?.signal;
      const headers = new Headers();
      if (opts?.rawBody !== undefined && opts.body != null) {
        throw new TypeError("body and rawBody are mutually exclusive");
      }
      if (method !== "GET" && opts?.rawBody !== undefined) {
        init.body = opts.rawBody;
      } else if (method !== "GET" && opts?.body != null) {
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

    // --- Fetch phase --------------------------------------------------------
    // A throw here is a genuine network / timeout / cancellation failure.
    let res: Response;
    try {
      const fetchImpl = cfg.fetchFn ?? fetch;
      res = await fetchImpl(url, init);
    } catch (e) {
      return classifyThrown(e, callerSignal);
    }

    // --- Response phase -----------------------------------------------------
    // The outer try preserves the never-throw guarantee for a malformed
    // result from a custom fetchFn and for a mid-body read failure. A
    // JSON.parse / decoder throw is a "decode" error, handled by its own
    // inner try before it can reach here.
    try {
      if (!res.ok) {
        return await parseErrorResponse(res, cfg.maxResponseBytes);
      }
      const status = statusOf(res);
      if (status === 204) {
        return { ok: true, status, data: undefined as T };
      }

      if (opts?.ignoreBody === true) {
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
            parsed,
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
 * successful result, or `null` on any error.
 */
export function makeRequest(raw: RequestRawFn): RequestFn {
  return async function request<T>(
    method: HttpMethod,
    path: string,
    opts?: RequestOptions<T>,
  ): Promise<T | null> {
    const result = await raw<T>(method, path, opts);
    return result.ok && result.data !== undefined ? result.data : null;
  };
}
