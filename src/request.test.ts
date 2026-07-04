// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { configureFetch, resetFetchConfig } from "./config.js";
import { request, requestRaw } from "./request.js";
import type { Decoder } from "./types.js";

/** Build a stub fetch that always resolves to the given Response. */
function stubFetch(res: Response): typeof fetch {
  return vi.fn().mockResolvedValue(res) as unknown as typeof fetch;
}

/** Read the (url, init) a fetch stub was called with. */
function callArgs(fn: typeof fetch): [string, RequestInit] {
  const calls = (fn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
  return calls[0]!;
}

beforeEach(() => {
  resetFetchConfig();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("requestRaw — happy paths", () => {
  it("GET returns parsed JSON with ok + status", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({ name: "foo" }), { status: 200 }));
    configureFetch({ fetchFn });
    const r = await requestRaw<{ name: string }>("GET", "/items/1");
    expect(r).toEqual({ ok: true, status: 200, data: { name: "foo" } });
    const [url, init] = callArgs(fetchFn);
    expect(url).toBe("/items/1");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("POST encodes the JSON body and sets Content-Type", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({ id: 7 }), { status: 201 }));
    configureFetch({ fetchFn });
    const r = await requestRaw<{ id: number }>("POST", "/items", { body: { name: "bar" } });
    expect(r).toEqual({ ok: true, status: 201, data: { id: 7 } });
    const [, init] = callArgs(fetchFn);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "bar" }));
    expect((init.headers as Headers).get("content-type")).toBe("application/json");
  });

  it("PUT and PATCH also encode the body and set Content-Type", async () => {
    for (const method of ["PUT", "PATCH"] as const) {
      const fetchFn = stubFetch(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
      configureFetch({ fetchFn });
      await requestRaw(method, "/items/1", { body: { v: 2 } });
      const [, init] = callArgs(fetchFn);
      expect(init.method).toBe(method);
      expect(init.body).toBe(JSON.stringify({ v: 2 }));
      expect((init.headers as Headers).get("content-type")).toBe("application/json");
    }
  });

  it("DELETE with no body sends no Content-Type", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    configureFetch({ fetchFn });
    const r = await requestRaw<{ deleted: boolean }>("DELETE", "/items/1");
    expect(r).toEqual({ ok: true, status: 200, data: { deleted: true } });
    const [, init] = callArgs(fetchFn);
    expect(init.body).toBeUndefined();
    expect((init.headers as Headers).get("content-type")).toBeNull();
  });

  it("POST without a body sets no Content-Type", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({}), { status: 200 }));
    configureFetch({ fetchFn });
    await requestRaw("POST", "/ping");
    const [, init] = callArgs(fetchFn);
    expect(init.body).toBeUndefined();
    expect((init.headers as Headers).get("content-type")).toBeNull();
  });
});

describe("requestRaw — empty bodies", () => {
  it("204 resolves to ok with undefined data (no parse)", async () => {
    const fetchFn = stubFetch(new Response(null, { status: 204 }));
    configureFetch({ fetchFn });
    const r = await requestRaw("DELETE", "/items/1");
    expect(r).toEqual({ ok: true, status: 204, data: undefined });
  });

  it("empty 200 body resolves to ok with undefined data", async () => {
    const fetchFn = stubFetch(new Response("", { status: 200 }));
    configureFetch({ fetchFn });
    const r = await requestRaw("GET", "/empty");
    expect(r).toEqual({ ok: true, status: 200, data: undefined });
  });
});

describe("requestRaw — non-2xx responses", () => {
  it("lifts error, code, and request_id from a JSON error body", async () => {
    const fetchFn = stubFetch(
      new Response(
        JSON.stringify({ error: "Not found", code: "not_found", request_id: "req-42" }),
        {
          status: 404,
        },
      ),
    );
    configureFetch({ fetchFn });
    const r = await requestRaw("GET", "/missing");
    expect(r).toEqual({
      ok: false,
      status: 404,
      error: "Not found",
      code: "not_found",
      requestId: "req-42",
    });
  });

  it("accepts a camelCase requestId field", async () => {
    const fetchFn = stubFetch(
      new Response(JSON.stringify({ error: "Boom", requestId: "req-9" }), { status: 500 }),
    );
    configureFetch({ fetchFn });
    const r = await requestRaw("GET", "/x");
    expect(r).toMatchObject({ ok: false, status: 500, error: "Boom", requestId: "req-9" });
    expect(r).not.toHaveProperty("code");
  });

  it("falls back to `HTTP <status>` for a non-JSON error body", async () => {
    const fetchFn = stubFetch(new Response("<html>oops</html>", { status: 503 }));
    configureFetch({ fetchFn });
    const r = await requestRaw("GET", "/x");
    expect(r).toEqual({ ok: false, status: 503, error: "HTTP 503" });
  });

  it("falls back to `HTTP <status>` for an empty error body", async () => {
    const fetchFn = stubFetch(new Response("", { status: 500 }));
    configureFetch({ fetchFn });
    const r = await requestRaw("GET", "/x");
    expect(r).toEqual({ ok: false, status: 500, error: "HTTP 500" });
  });

  it("falls back to `HTTP <status>` when the JSON error body has no error field", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({ detail: "nope" }), { status: 422 }));
    configureFetch({ fetchFn });
    const r = await requestRaw("GET", "/x");
    expect(r).toEqual({ ok: false, status: 422, error: "HTTP 422" });
  });
});

describe("requestRaw — decoding", () => {
  it("returns parsed data when no decoder is supplied", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify([1, 2, 3]), { status: 200 }));
    configureFetch({ fetchFn });
    const r = await requestRaw<number[]>("GET", "/nums");
    expect(r).toEqual({ ok: true, status: 200, data: [1, 2, 3] });
  });

  it("runs a supplied decoder on the 2xx body", async () => {
    const decoder: Decoder<{ n: number }> = (v) => {
      if (typeof v !== "object" || v === null || typeof (v as { n: unknown }).n !== "number") {
        throw new Error("expected { n: number }");
      }
      return v as { n: number };
    };
    const fetchFn = stubFetch(new Response(JSON.stringify({ n: 5 }), { status: 200 }));
    configureFetch({ fetchFn });
    const r = await requestRaw("GET", "/n", { decoder });
    expect(r).toEqual({ ok: true, status: 200, data: { n: 5 } });
  });

  it("maps a decoder throw to code 'decode'", async () => {
    const decoder: Decoder<{ n: number }> = () => {
      throw new Error("expected { n: number }");
    };
    const fetchFn = stubFetch(new Response(JSON.stringify({ wrong: true }), { status: 200 }));
    configureFetch({ fetchFn });
    const r = await requestRaw("GET", "/n", { decoder });
    expect(r).toEqual({
      ok: false,
      status: 200,
      code: "decode",
      error: "response shape mismatch: expected { n: number }",
    });
  });

  it("preserves a raw string thrown by a decoder", async () => {
    const decoder: Decoder<unknown> = () => {
      throw "raw failure";
    };
    const fetchFn = stubFetch(new Response(JSON.stringify({}), { status: 200 }));
    configureFetch({ fetchFn });
    const r = await requestRaw("GET", "/n", { decoder });
    expect(r).toEqual({
      ok: false,
      status: 200,
      code: "decode",
      error: "response shape mismatch: raw failure",
    });
  });

  it("falls back to 'unknown error' when a decoder throws a non-Error, non-string", async () => {
    const decoder: Decoder<unknown> = () => {
      throw { weird: true };
    };
    const fetchFn = stubFetch(new Response(JSON.stringify({}), { status: 200 }));
    configureFetch({ fetchFn });
    const r = await requestRaw("GET", "/n", { decoder });
    expect(r).toEqual({
      ok: false,
      status: 200,
      code: "decode",
      error: "response shape mismatch: unknown error",
    });
  });

  it("maps a JSON.parse failure to code 'decode'", async () => {
    const fetchFn = stubFetch(new Response("not json{", { status: 200 }));
    configureFetch({ fetchFn });
    const r = await requestRaw("GET", "/n");
    expect(r.ok).toBe(false);
    expect((r as { code?: string }).code).toBe("decode");
    expect((r as { error: string }).error).toContain("response not JSON:");
    expect((r as { status: number }).status).toBe(200);
  });
});

describe("requestRaw — thrown fetch errors", () => {
  it("classifies a TypeError as code 'network' with status 0", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;
    configureFetch({ fetchFn });
    const r = await requestRaw("GET", "/x");
    expect(r).toEqual({ ok: false, status: 0, code: "network", error: "Failed to fetch" });
  });

  it("classifies a TimeoutError DOMException as code 'timeout'", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValue(
        new DOMException("The operation timed out", "TimeoutError"),
      ) as unknown as typeof fetch;
    configureFetch({ fetchFn });
    const r = await requestRaw("GET", "/x");
    expect(r).toEqual({ ok: false, status: 0, code: "timeout", error: "The operation timed out" });
  });

  it("classifies a bare AbortError (no caller abort) as code 'timeout'", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValue(new DOMException("aborted", "AbortError")) as unknown as typeof fetch;
    configureFetch({ fetchFn });
    const r = await requestRaw("GET", "/x");
    expect(r).toEqual({ ok: false, status: 0, code: "timeout", error: "aborted" });
  });

  it("classifies a failure as 'cancelled' when the caller signal is aborted", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValue(
        new DOMException("The operation was aborted", "AbortError"),
      ) as unknown as typeof fetch;
    configureFetch({ fetchFn });
    const ac = new AbortController();
    ac.abort();
    const r = await requestRaw("GET", "/x", { signal: ac.signal });
    expect(r).toEqual({ ok: false, status: 0, code: "cancelled", error: "request cancelled" });
  });

  it("never throws — a fetch resolving to null is classified, not propagated", async () => {
    const fetchFn = (async () => null) as unknown as typeof fetch;
    configureFetch({ fetchFn });
    const r = await requestRaw("GET", "/x");
    expect(r.ok).toBe(false);
    expect((r as { code?: string }).code).toBe("network");
  });
});

describe("request — null collapsing", () => {
  it("returns data on ok", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({ a: 1 }), { status: 200 }));
    configureFetch({ fetchFn });
    const data = await request<{ a: number }>("GET", "/x");
    expect(data).toEqual({ a: 1 });
  });

  it("returns null on error", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({ error: "no" }), { status: 400 }));
    configureFetch({ fetchFn });
    const data = await request("GET", "/x");
    expect(data).toBeNull();
  });

  it("returns undefined (not null) on a 204 success", async () => {
    const fetchFn = stubFetch(new Response(null, { status: 204 }));
    configureFetch({ fetchFn });
    const data = await request("DELETE", "/x");
    expect(data).toBeUndefined();
  });
});

describe("request — global fetch fallback", () => {
  it("uses the global fetch when no fetchFn is configured", async () => {
    const globalFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ g: true }), { status: 200 }));
    vi.stubGlobal("fetch", globalFetch);
    const data = await request<{ g: boolean }>("GET", "/x");
    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(data).toEqual({ g: true });
  });
});
