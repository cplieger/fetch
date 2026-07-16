// Public surface of @cplieger/fetch.
// ---------------------------------------------------------------------------

// Instance factory — the only configuration surface. Config is captured
// immutably at construction; a changed backend produces a new instance.
export { createFetch } from "./instance.js";
export type { FetchInstance } from "./instance.js";

// Timeout composition
export { API_TIMEOUT_MS, withTimeout } from "./timeout.js";

// Types
export type {
  ApiErr,
  ApiOk,
  ApiResult,
  Decoder,
  FetchConfig,
  HttpMethod,
  RequestOptions,
} from "./types.js";
