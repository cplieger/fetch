// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFetch, apiGet, type FetchInstance } from "./instance.js";
import { configureFetch, resetFetchConfig } from "./config.js";

function stubFetch(res: Response): typeof fetch {
  return vi.fn().mockResolvedValue(res) as unknown as typeof fetch;
}
function urlOf(fn: typeof fetch): string {
  return (fn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![0];
}

beforeEach(() => {
  resetFetchConfig();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("createFetch — instance isolation", () => {
  it("isolates baseUrl + fetchFn between two instances", async () => {
    const fa = stubFetch(new Response("{}", { status: 200 }));
    const fb = stubFetch(new Response("{}", { status: 200 }));
    const a = createFetch({ baseUrl: "https://a.test", fetchFn: fa });
    const b = createFetch({ baseUrl: "https://b.test", fetchFn: fb });
    await a.apiGet("/x");
    await b.apiGet("/y");
    expect(urlOf(fa)).toBe("https://a.test/x");
    expect(urlOf(fb)).toBe("https://b.test/y");
    expect(fa).toHaveBeenCalledTimes(1);
    expect(fb).toHaveBeenCalledTimes(1);
  });

  it("does not leak config between an instance and the module-global default", async () => {
    const fInst = stubFetch(new Response("{}", { status: 200 }));
    const fDefault = stubFetch(new Response("{}", { status: 200 }));
    const inst = createFetch({ baseUrl: "https://inst.test", fetchFn: fInst });
    // Configuring the default AFTER the instance exists must not touch it.
    configureFetch({ baseUrl: "https://default.test", fetchFn: fDefault });
    await inst.apiGet("/x");
    await apiGet("/y");
    expect(urlOf(fInst)).toBe("https://inst.test/x");
    expect(urlOf(fDefault)).toBe("https://default.test/y");
    expect(fInst).toHaveBeenCalledTimes(1);
    expect(fDefault).toHaveBeenCalledTimes(1);
  });

  it("configure() shallow-merges into an instance (baseUrl retained)", async () => {
    const f = stubFetch(new Response("{}", { status: 200 }));
    const inst = createFetch({ baseUrl: "https://c.test" });
    inst.configure({ fetchFn: f });
    await inst.apiGet("/x");
    expect(urlOf(f)).toBe("https://c.test/x");
  });

  it("reads config per call, so a later configure() is reflected", async () => {
    const f1 = stubFetch(new Response("{}", { status: 200 }));
    const f2 = stubFetch(new Response("{}", { status: 200 }));
    const inst = createFetch({ baseUrl: "https://d.test", fetchFn: f1 });
    await inst.apiGet("/first");
    inst.configure({ fetchFn: f2 });
    await inst.apiGet("/second");
    expect(f1).toHaveBeenCalledTimes(1);
    expect(f2).toHaveBeenCalledTimes(1);
    expect(urlOf(f2)).toBe("https://d.test/second");
  });

  it("exposes requestRaw, request, configure, and all 12 verb helpers", () => {
    const inst = createFetch();
    const keys = [
      "requestRaw",
      "request",
      "configure",
      "apiGet",
      "apiPost",
      "apiPut",
      "apiPatch",
      "apiDelete",
      "apiGetTyped",
      "apiPostTyped",
      "apiGetRaw",
      "apiPostRaw",
      "apiPutRaw",
      "apiPatchRaw",
      "apiDeleteRaw",
    ] as const satisfies readonly (keyof FetchInstance)[];
    for (const k of keys) {
      expect(typeof inst[k]).toBe("function");
    }
  });

  it("instance requestRaw returns the full envelope; verbs null-collapse", async () => {
    // A fresh Response per call — a Response body is single-read, so a shared
    // instance would be consumed by the first call and read empty by the second.
    const f = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ a: 1 }), { status: 200 })),
    ) as unknown as typeof fetch;
    const inst = createFetch({ fetchFn: f });
    const raw = await inst.apiGetRaw<{ a: number }>("/x");
    expect(raw).toEqual({ ok: true, status: 200, data: { a: 1 } });
    const data = await inst.apiGet<{ a: number }>("/x");
    expect(data).toEqual({ a: 1 });
  });
});
