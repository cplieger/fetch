// Module-global fetch configuration. An injection seam modelled on RTK's
// fetchBaseQuery: baseUrl, credentials, a header-preparation hook, and a
// custom fetch implementation for tests / SSR.
// ---------------------------------------------------------------------------

/** Configuration for the global fetch layer. Set via {@link configureFetch}. */
export interface FetchConfig {
  /** Prepended to relative paths. The trailing `/` is stripped and a leading
   *  `/` is ensured on the path before joining.
   *
   *  CONTRACT: `path` is treated as a RELATIVE path. With `baseUrl` set, the
   *  configured scheme+host always precede it, so an absolute (`https://…`) or
   *  protocol-relative (`//host`) path is neutralised (kept as a path segment)
   *  and cannot override the origin. With `baseUrl` UNSET, `path` is passed to
   *  `fetch()` verbatim — the caller owns the full URL and must never pass
   *  untrusted input as the whole path. */
  baseUrl?: string;
  /** `RequestInit.credentials` mode applied to every request (e.g. `"include"`
   *  for cookies). */
  credentials?: RequestCredentials;
  /** Custom fetch implementation. Useful for SSR (isomorphic fetch) or tests. */
  fetchFn?: typeof fetch;
  /** Inject headers on every request. Mutate the provided instance and/or
   *  return a replacement (RTK convention: a returned `Headers` wins wholesale,
   *  otherwise the mutated instance is used). May be async (e.g. to read a
   *  token store). */
  prepareHeaders?: (headers: Headers) => Headers | undefined | Promise<Headers | undefined>;
}

let config: FetchConfig = {};

/**
 * Configure the global fetch layer used by every request. Shallow-merges into
 * the existing config, so successive calls accumulate rather than replace.
 * Call at app boot (and again to override individual fields).
 *
 * @example
 * ```ts
 * configureFetch({
 *   baseUrl: "https://api.example.com/v1",
 *   credentials: "include",
 *   prepareHeaders: (headers) => {
 *     headers.set("Authorization", `Bearer ${getToken()}`);
 *   },
 * });
 * ```
 */
export function configureFetch(newConfig: FetchConfig): void {
  config = { ...config, ...newConfig };
}

/** Reset the global fetch config to empty. @internal Test-only. */
export function resetFetchConfig(): void {
  config = {};
}

/** Read the current global fetch config. @internal Used by request.ts. */
export function getFetchConfig(): FetchConfig {
  return config;
}
