// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { configureFetch, resetFetchConfig } from "./config.js";
import {
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
  apiGetTyped,
  apiPostTyped,
  apiPutTyped,
  apiPatchTyped,
  apiDeleteTyped,
  apiGetRaw,
  apiPostRaw,
  apiPutRaw,
  apiPatchRaw,
  apiDeleteRaw,
} from "./verbs.js";
import type { Decoder } from "./types.js";

function stubFetch(res: Response): typeof fetch {
  return vi.fn().mockResolvedValue(res) as unknown as typeof fetch;
}
function call(fn: typeof fetch): [string, RequestInit] {
  return (fn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
}

beforeEach(() => {
  resetFetchConfig();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("null-collapsing verb helpers", () => {
  it("apiGet issues a GET and returns data", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({ a: 1 }), { status: 200 }));
    configureFetch({ fetchFn });
    const data = await apiGet<{ a: number }>("/x");
    expect(data).toEqual({ a: 1 });
    expect(call(fetchFn)[1].method).toBe("GET");
  });

  it("apiPost issues a POST with a JSON body", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({ id: 1 }), { status: 201 }));
    configureFetch({ fetchFn });
    const data = await apiPost<{ id: number }>("/x", { name: "n" });
    expect(data).toEqual({ id: 1 });
    const [, init] = call(fetchFn);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "n" }));
    expect((init.headers as Headers).get("content-type")).toBe("application/json");
  });

  it("apiPut and apiPatch issue their verb with a body", async () => {
    for (const [fn, method] of [
      [apiPut, "PUT"],
      [apiPatch, "PATCH"],
    ] as const) {
      const fetchFn = stubFetch(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
      configureFetch({ fetchFn });
      await fn("/x", { v: 1 });
      expect(call(fetchFn)[1].method).toBe(method);
      expect(call(fetchFn)[1].body).toBe(JSON.stringify({ v: 1 }));
    }
  });

  it("apiDelete issues a DELETE with no body (204 collapses to null)", async () => {
    const fetchFn = stubFetch(new Response(null, { status: 204 }));
    configureFetch({ fetchFn });
    const data = await apiDelete("/x");
    expect(data).toBeNull();
    expect(call(fetchFn)[1].method).toBe("DELETE");
    expect(call(fetchFn)[1].body).toBeUndefined();
  });

  it("returns null on an error status", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({ error: "no" }), { status: 500 }));
    configureFetch({ fetchFn });
    expect(await apiGet("/x")).toBeNull();
  });

  it("threads per-request opts (headers) alongside the body", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({}), { status: 200 }));
    configureFetch({ fetchFn });
    await apiPost("/x", { a: 1 }, { headers: { "X-Req": "1" } });
    const [, init] = call(fetchFn);
    expect((init.headers as Headers).get("x-req")).toBe("1");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("lets the body argument win over an opts.body", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({}), { status: 200 }));
    configureFetch({ fetchFn });
    await apiPost("/x", { winner: true }, { body: { loser: true } });
    expect(call(fetchFn)[1].body).toBe(JSON.stringify({ winner: true }));
  });
});

describe("decoder-validated verb helpers", () => {
  const numDecoder: Decoder<{ n: number }> = (v) => {
    if (typeof v !== "object" || v === null || typeof (v as { n: unknown }).n !== "number") {
      throw new Error("bad shape");
    }
    return v as { n: number };
  };

  it("apiGetTyped validates and returns data", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({ n: 3 }), { status: 200 }));
    configureFetch({ fetchFn });
    expect(await apiGetTyped("/x", numDecoder)).toEqual({ n: 3 });
  });

  it("apiGetTyped returns null when the decoder rejects the shape", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({ wrong: 1 }), { status: 200 }));
    configureFetch({ fetchFn });
    expect(await apiGetTyped("/x", numDecoder)).toBeNull();
  });

  it("apiPostTyped sends the body, validates, and returns data", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({ n: 9 }), { status: 200 }));
    configureFetch({ fetchFn });
    const data = await apiPostTyped("/x", { in: true }, numDecoder);
    expect(data).toEqual({ n: 9 });
    expect(call(fetchFn)[1].body).toBe(JSON.stringify({ in: true }));
  });
});

describe("envelope (*Raw) verb helpers", () => {
  it("apiGetRaw returns an ok envelope", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({ a: 1 }), { status: 200 }));
    configureFetch({ fetchFn });
    expect(await apiGetRaw("/x")).toEqual({ ok: true, status: 200, data: { a: 1 } });
  });

  it("apiGetRaw returns an err envelope with lifted fields", async () => {
    const fetchFn = stubFetch(
      new Response(JSON.stringify({ error: "bad", code: "c1" }), { status: 400 }),
    );
    configureFetch({ fetchFn });
    expect(await apiGetRaw("/x")).toEqual({ ok: false, status: 400, error: "bad", code: "c1" });
  });

  it("apiPostRaw / apiPutRaw / apiPatchRaw send a body and return an envelope", async () => {
    for (const [fn, method] of [
      [apiPostRaw, "POST"],
      [apiPutRaw, "PUT"],
      [apiPatchRaw, "PATCH"],
    ] as const) {
      const fetchFn = stubFetch(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
      configureFetch({ fetchFn });
      const r = await fn("/x", { v: 1 });
      expect(r).toEqual({ ok: true, status: 200, data: { ok: 1 } });
      expect(call(fetchFn)[1].method).toBe(method);
      expect(call(fetchFn)[1].body).toBe(JSON.stringify({ v: 1 }));
    }
  });

  it("apiDeleteRaw returns an envelope", async () => {
    const fetchFn = stubFetch(new Response(null, { status: 204 }));
    configureFetch({ fetchFn });
    expect(await apiDeleteRaw("/x")).toEqual({ ok: true, status: 204, data: undefined });
  });
});

describe("null body + empty body helpers", () => {
  it("apiPost with a null body sends no body / no Content-Type", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({}), { status: 200 }));
    configureFetch({ fetchFn });
    await apiPost("/x", null);
    const [, init] = call(fetchFn);
    expect(init.body).toBeUndefined();
    expect((init.headers as Headers).get("content-type")).toBeNull();
  });

  it("apiGetRaw surfaces an empty body as ok with undefined data", async () => {
    const fetchFn = stubFetch(new Response("", { status: 200 }));
    configureFetch({ fetchFn });
    expect(await apiGetRaw("/x")).toEqual({ ok: true, status: 200, data: undefined });
  });
});

describe("decoder-validated *Typed helpers (PUT / PATCH / DELETE)", () => {
  const numDecoder: Decoder<{ n: number }> = (v) => {
    if (typeof v !== "object" || v === null || typeof (v as { n: unknown }).n !== "number") {
      throw new Error("bad shape");
    }
    return v as { n: number };
  };
  const throwingDecoder: Decoder<{ n: number }> = () => {
    throw new Error("nope");
  };

  it("apiPutTyped / apiPatchTyped send the body, validate, and return data", async () => {
    for (const [fn, method] of [
      [apiPutTyped, "PUT"],
      [apiPatchTyped, "PATCH"],
    ] as const) {
      const fetchFn = stubFetch(new Response(JSON.stringify({ n: 4 }), { status: 200 }));
      configureFetch({ fetchFn });
      const data = await fn("/x", { in: true }, numDecoder);
      expect(data).toEqual({ n: 4 });
      expect(call(fetchFn)[1].method).toBe(method);
      expect(call(fetchFn)[1].body).toBe(JSON.stringify({ in: true }));
    }
  });

  it("apiDeleteTyped validates and returns data", async () => {
    const fetchFn = stubFetch(new Response(JSON.stringify({ n: 7 }), { status: 200 }));
    configureFetch({ fetchFn });
    const data = await apiDeleteTyped("/x", numDecoder);
    expect(data).toEqual({ n: 7 });
    expect(call(fetchFn)[1].method).toBe("DELETE");
  });

  it("apiPutTyped / apiPatchTyped / apiDeleteTyped return null when the decoder throws", async () => {
    const cases = [
      () => apiPutTyped("/x", {}, throwingDecoder),
      () => apiPatchTyped("/x", {}, throwingDecoder),
      () => apiDeleteTyped("/x", throwingDecoder),
    ];
    for (const run of cases) {
      const fetchFn = stubFetch(new Response(JSON.stringify({ wrong: 1 }), { status: 200 }));
      configureFetch({ fetchFn });
      expect(await run()).toBeNull();
    }
  });
});
