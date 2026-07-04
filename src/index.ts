// Public surface of @cplieger/fetch.
// ---------------------------------------------------------------------------

// Configuration
export { configureFetch, resetFetchConfig } from "./config.js";
export type { FetchConfig } from "./config.js";

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
