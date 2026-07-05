// Public surface of @cplieger/fetch.
// ---------------------------------------------------------------------------

// Configuration
export { configureFetch } from "./config.js";
export type { FetchConfig } from "./config.js";

// Instance factory — isolated per-instance config. The default surface below
// (request/requestRaw + the verb helpers + configureFetch) delegates to a
// module-global instance; createFetch builds independent ones.
export { createFetch } from "./instance.js";
export type { FetchInstance } from "./instance.js";

// Timeout composition
export { API_TIMEOUT_MS, withTimeout } from "./timeout.js";

// Request core
export { request, requestRaw } from "./request.js";

// Verb helpers
export {
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
  apiGetTyped,
  apiPostTyped,
  apiGetRaw,
  apiPostRaw,
  apiPutRaw,
  apiPatchRaw,
  apiDeleteRaw,
} from "./verbs.js";

// Types
export type { ApiErr, ApiOk, ApiResult, Decoder, HttpMethod, RequestOptions } from "./types.js";
