// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { API_TIMEOUT_MS, withTimeout } from "./timeout.js";

describe("API_TIMEOUT_MS", () => {
  it("defaults to 30 seconds", () => {
    expect(API_TIMEOUT_MS).toBe(30_000);
  });
});

describe("withTimeout", () => {
  it("returns a fresh, non-aborted signal when no caller signal is given", () => {
    const signal = withTimeout(undefined, 60_000);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it("returns a signal that aborts when the caller signal aborts", () => {
    const ac = new AbortController();
    const composed = withTimeout(ac.signal, 60_000);
    expect(composed.aborted).toBe(false);
    ac.abort();
    expect(composed.aborted).toBe(true);
  });

  it("is already aborted when the caller signal is already aborted", () => {
    const ac = new AbortController();
    ac.abort();
    const composed = withTimeout(ac.signal, 60_000);
    expect(composed.aborted).toBe(true);
  });

  it("drops the caller signal but keeps the timeout when AbortSignal.any is unavailable", () => {
    const orig = AbortSignal.any;
    (AbortSignal as { any?: unknown }).any = undefined;
    try {
      const ac = new AbortController();
      const composed = withTimeout(ac.signal, 60_000);
      expect(composed).toBeInstanceOf(AbortSignal);
      expect(composed.aborted).toBe(false);
      ac.abort();
      expect(composed.aborted).toBe(false);
    } finally {
      (AbortSignal as { any?: unknown }).any = orig;
    }
  });
});
