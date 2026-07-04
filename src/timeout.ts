// Request timeout composition. Mirrors the withTimeout helper from
// @cplieger/actions so both libraries share the same cancellation shape.
// ---------------------------------------------------------------------------

/** Default request timeout in milliseconds. */
export const API_TIMEOUT_MS = 30_000;

/**
 * Compose an optional caller signal with a fresh timeout signal.
 *
 * If the caller provides a signal, the result aborts when either the caller
 * signal or the timeout fires — whichever comes first (via `AbortSignal.any`).
 * If `signal` is undefined, the result is a bare `AbortSignal.timeout(ms)`.
 *
 * @param signal - Existing caller signal to compose with (may be undefined).
 * @param ms - Timeout in milliseconds.
 * @returns A composed AbortSignal.
 */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  return signal !== undefined
    ? AbortSignal.any([signal, AbortSignal.timeout(ms)])
    : AbortSignal.timeout(ms);
}
