// Request timeout composition. The toolkit's single implementation:
// @cplieger/actions and app layers import these rather than carrying copies.
// ---------------------------------------------------------------------------

/** Default request timeout in milliseconds. */
export const API_TIMEOUT_MS = 30_000;

/**
 * Compose an optional caller signal with a fresh timeout signal.
 *
 * If the caller provides a signal AND the runtime supports `AbortSignal.any`,
 * the result aborts when either the caller signal or the timeout fires —
 * whichever comes first. With no caller signal, or on a runtime that lacks
 * `AbortSignal.any`, the result is a bare `AbortSignal.timeout(ms)` so the
 * timeout still applies and the request never silently fails to build.
 *
 * @param signal - Existing caller signal to compose with (may be undefined).
 * @param ms - Timeout in milliseconds.
 * @returns A composed AbortSignal.
 */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  if (signal !== undefined && typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
  }
  // No caller signal, or no AbortSignal.any: the timeout still applies.
  return AbortSignal.timeout(ms);
}
