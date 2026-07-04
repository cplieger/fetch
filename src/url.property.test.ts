// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { configureFetch, resetFetchConfig } from "./config.js";
import { requestRaw } from "./request.js";

const ORIGIN = "https://api.example.com";

// Non-empty path segments over a slash-free alphabet (version-agnostic:
// avoids the fast-check string-generator API churn between majors).
const SEG_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
const segment = fc
  .array(fc.constantFrom(...SEG_CHARS), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(""));

describe("baseUrl + path joining (property)", () => {
  it("always joins with exactly one slash, never drops the path", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(segment, { minLength: 1, maxLength: 5 }),
        fc.boolean(),
        fc.boolean(),
        async (segs, baseTrailingSlash, pathLeadingSlash) => {
          const baseUrl = ORIGIN + (baseTrailingSlash ? "/" : "");
          const path = (pathLeadingSlash ? "/" : "") + segs.join("/");

          resetFetchConfig();
          const fetchFn = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
          configureFetch({ baseUrl, fetchFn });
          await requestRaw("GET", path);

          const url = fetchFn.mock.calls[0]![0] as string;
          const expectedPath = segs.join("/");

          // Exactly one slash at the join, path preserved verbatim.
          expect(url).toBe(`${ORIGIN}/${expectedPath}`);
          // No double slash anywhere after the scheme separator.
          expect(url.slice("https://".length)).not.toContain("//");
          // Every segment survives, in order.
          expect(url.endsWith(expectedPath)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("passes the path through verbatim when no baseUrl is configured", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(segment, { minLength: 1, maxLength: 5 }), async (segs) => {
        const path = `/${segs.join("/")}`;
        resetFetchConfig();
        const fetchFn = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
        configureFetch({ fetchFn });
        await requestRaw("GET", path);
        expect(fetchFn.mock.calls[0]![0]).toBe(path);
      }),
      { numRuns: 100 },
    );
  });
});
