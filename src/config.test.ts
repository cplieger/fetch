// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { configureFetch, resetFetchConfig, getFetchConfig } from "./config.js";
import { requestRaw } from "./instance.js";

function stubFetch(res: Response): typeof fetch {
  return vi.fn().mockResolvedValue(res) as unknown as typeof fetch;
}
function urlOf(fn: typeof fetch): string {
  return (fn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![0];
}
function initOf(fn: typeof fetch): RequestInit {
  return (fn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1];
}

beforeEach(() => {
  resetFetchConfig();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("configureFetch — baseUrl join", () => {
  it("prepends baseUrl to the path", async () => {
    const fetchFn = stubFetch(new Response("{}", { status: 200 }));
    configureFetch({ baseUrl: "https://api.example.com/v1", fetchFn });
    await requestRaw("GET", "/items/42");
    expect(urlOf(fetchFn)).toBe("https://api.example.com/v1/items/42");
  });

  it("collapses the double slash when base ends with '/' and path starts with '/'", async () => {
    const fetchFn = stubFetch(new Response("{}", { status: 200 }));
    configureFetch({ baseUrl: "https://api.example.com/", fetchFn });
    await requestRaw("GET", "/items/42");
    expect(urlOf(fetchFn)).toBe("https://api.example.com/items/42");
  });

  it("inserts a single slash when base has a trailing slash and path has no leading slash", async () => {
    const fetchFn = stubFetch(new Response("{}", { status: 200 }));
    configureFetch({ baseUrl: "https://api.example.com/", fetchFn });
    await requestRaw("GET", "items");
    expect(urlOf(fetchFn)).toBe("https://api.example.com/items");
  });

  it("inserts a single slash when neither base nor path carry one", async () => {
    const fetchFn = stubFetch(new Response("{}", { status: 200 }));
    configureFetch({ baseUrl: "https://api.example.com", fetchFn });
    await requestRaw("GET", "items");
    expect(urlOf(fetchFn)).toBe("https://api.example.com/items");
  });

  it("preserves the query string", async () => {
    const fetchFn = stubFetch(new Response("{}", { status: 200 }));
    configureFetch({ baseUrl: "https://api.example.com/v1", fetchFn });
    await requestRaw("GET", "/items?foo=bar&baz=1");
    expect(urlOf(fetchFn)).toBe("https://api.example.com/v1/items?foo=bar&baz=1");
  });

  it("passes the path verbatim when no baseUrl is set", async () => {
    const fetchFn = stubFetch(new Response("{}", { status: 200 }));
    configureFetch({ fetchFn });
    await requestRaw("GET", "/items/1");
    expect(urlOf(fetchFn)).toBe("/items/1");
  });
});

describe("configureFetch — prepareHeaders", () => {
  it("injects headers by mutating the provided instance", async () => {
    const fetchFn = stubFetch(new Response("{}", { status: 200 }));
    configureFetch({
      fetchFn,
      prepareHeaders: (headers) => {
        headers.set("Authorization", "Bearer tok");
      },
    });
    await requestRaw("GET", "/me");
    expect((initOf(fetchFn).headers as Headers).get("authorization")).toBe("Bearer tok");
  });

  it("honors a Headers object returned by prepareHeaders, replacing the mutated one", async () => {
    const fetchFn = stubFetch(new Response("{}", { status: 200 }));
    configureFetch({
      fetchFn,
      prepareHeaders: (headers) => {
        headers.set("X-Mutated", "ignored");
        const replacement = new Headers();
        replacement.set("Authorization", "Bearer returned");
        return replacement;
      },
    });
    await requestRaw("GET", "/x");
    const headers = initOf(fetchFn).headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer returned");
    expect(headers.get("x-mutated")).toBeNull();
  });

  it("awaits an async prepareHeaders", async () => {
    const fetchFn = stubFetch(new Response("{}", { status: 200 }));
    configureFetch({
      fetchFn,
      prepareHeaders: async (headers) => {
        await Promise.resolve();
        headers.set("X-Async", "1");
        return undefined;
      },
    });
    await requestRaw("GET", "/x");
    expect((initOf(fetchFn).headers as Headers).get("x-async")).toBe("1");
  });

  it("runs after per-request headers, so prepareHeaders wins", async () => {
    const fetchFn = stubFetch(new Response("{}", { status: 200 }));
    configureFetch({
      fetchFn,
      prepareHeaders: (headers) => {
        headers.set("X-Override", "from-global");
      },
    });
    await requestRaw("GET", "/x", { headers: { "X-Override": "from-spec", "X-Keep": "yes" } });
    const headers = initOf(fetchFn).headers as Headers;
    expect(headers.get("x-override")).toBe("from-global");
    expect(headers.get("x-keep")).toBe("yes");
  });

  it("classifies a prepareHeaders throw without calling fetch", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 })) as unknown as typeof fetch;
    configureFetch({
      fetchFn,
      prepareHeaders: () => {
        throw new Error("token refresh failed");
      },
    });
    const r = await requestRaw("GET", "/x");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("token refresh failed");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("configureFetch — credentials", () => {
  it("applies the configured credentials mode", async () => {
    const fetchFn = stubFetch(new Response("{}", { status: 200 }));
    configureFetch({ credentials: "include", fetchFn });
    await requestRaw("GET", "/x");
    expect(initOf(fetchFn).credentials).toBe("include");
  });

  it("omits credentials when not configured", async () => {
    const fetchFn = stubFetch(new Response("{}", { status: 200 }));
    configureFetch({ fetchFn });
    await requestRaw("GET", "/x");
    expect(initOf(fetchFn).credentials).toBeUndefined();
  });
});

describe("configureFetch — per-request headers", () => {
  it("merges a plain-object headers map", async () => {
    const fetchFn = stubFetch(new Response("{}", { status: 200 }));
    configureFetch({ fetchFn });
    await requestRaw("GET", "/x", { headers: { "X-Custom": "val" } });
    expect((initOf(fetchFn).headers as Headers).get("x-custom")).toBe("val");
  });

  it("merges a Headers instance", async () => {
    const fetchFn = stubFetch(new Response("{}", { status: 200 }));
    configureFetch({ fetchFn });
    const h = new Headers();
    h.set("X-From-Headers", "yes");
    await requestRaw("GET", "/x", { headers: h });
    expect((initOf(fetchFn).headers as Headers).get("x-from-headers")).toBe("yes");
  });

  it("keeps a per-request Content-Type override on a POST", async () => {
    const fetchFn = stubFetch(new Response("{}", { status: 200 }));
    configureFetch({ fetchFn });
    await requestRaw("POST", "/x", {
      body: { a: 1 },
      headers: { "Content-Type": "application/merge-patch+json" },
    });
    expect((initOf(fetchFn).headers as Headers).get("content-type")).toBe(
      "application/merge-patch+json",
    );
  });
});

describe("configureFetch — merge + reset semantics", () => {
  it("shallow-merges across successive calls", () => {
    configureFetch({ baseUrl: "https://a.test" });
    configureFetch({ credentials: "include" });
    const cfg = getFetchConfig();
    expect(cfg.baseUrl).toBe("https://a.test");
    expect(cfg.credentials).toBe("include");
  });

  it("overrides individual fields on re-configure", () => {
    configureFetch({ baseUrl: "https://a.test" });
    configureFetch({ baseUrl: "https://b.test" });
    expect(getFetchConfig().baseUrl).toBe("https://b.test");
  });

  it("resetFetchConfig clears everything", () => {
    configureFetch({ baseUrl: "https://a.test", credentials: "include" });
    resetFetchConfig();
    expect(getFetchConfig()).toEqual({});
  });
});

describe("configureFetch — baseUrl origin protection", () => {
  it("keeps the configured origin when the path is an absolute URL", async () => {
    const fetchFn = stubFetch(new Response("{}", { status: 200 }));
    configureFetch({ baseUrl: "https://api.example.com/v1", fetchFn });
    await requestRaw("GET", "https://evil.com/x");
    // The absolute path is demoted to a path segment; the origin is preserved.
    expect(urlOf(fetchFn)).toBe("https://api.example.com/v1/https://evil.com/x");
  });

  it("keeps the configured origin when the path is protocol-relative", async () => {
    const fetchFn = stubFetch(new Response("{}", { status: 200 }));
    configureFetch({ baseUrl: "https://api.example.com/v1", fetchFn });
    await requestRaw("GET", "//evil.com/x");
    expect(urlOf(fetchFn)).toBe("https://api.example.com/v1//evil.com/x");
  });
});
