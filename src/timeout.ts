/** Default request timeout in milliseconds. */
export const API_TIMEOUT_MS = 30_000;

/**
 * Compose an optional caller signal with a fresh timeout signal: aborts on
 * whichever fires first. Falls back to a bare `AbortSignal.timeout(ms)` when
 * no caller signal is given or the runtime lacks `AbortSignal.any`.
 */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  if (signal !== undefined && typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
  }
  return AbortSignal.timeout(ms);
}
