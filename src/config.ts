// Fetch configuration. An injection seam modelled on RTK's fetchBaseQuery:
// baseUrl, credentials, a header-preparation hook, and a custom fetch
// implementation for tests / SSR. Each fetch instance (createFetch) owns an
// isolated ConfigStore; the module-global default surface (configureFetch /
// getFetchConfig / resetFetchConfig) is backed by one default store.
// ---------------------------------------------------------------------------

/** Configuration for a fetch layer. Set via {@link configureFetch} (default
 *  instance) or the `initialConfig` / `configure` of a {@link createFetch}
 *  instance. */
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

/**
 * An isolated configuration holder. Each fetch instance ({@link createFetch})
 * owns one, and the module-global default surface is backed by one too, so the
 * config read by a request is scoped to its own instance.
 */
export interface ConfigStore {
  /** Read the current config. Live reference — callers must not mutate it. */
  get: () => FetchConfig;
  /** Shallow-merge `next` into the held config (accumulate, not replace). */
  configure: (next: FetchConfig) => void;
  /** Reset the held config to empty. @internal Test-only. */
  reset: () => void;
}

/**
 * Create an isolated config store seeded (shallow copy) with `initial`. Backs
 * both {@link createFetch} instances and the module-global default surface.
 */
export function createConfigStore(initial: FetchConfig = {}): ConfigStore {
  let config: FetchConfig = { ...initial };
  return {
    get: (): FetchConfig => config,
    configure: (next: FetchConfig): void => {
      config = { ...config, ...next };
    },
    reset: (): void => {
      config = {};
    },
  };
}

// The module-global default store — backs configureFetch / getFetchConfig /
// resetFetchConfig and the default fetch instance (the top-level apiGet/…).
const defaultStore = createConfigStore();

/**
 * Configure the global fetch layer used by every top-level request. Shallow-
 * merges into the existing config, so successive calls accumulate rather than
 * replace. Call at app boot (and again to override individual fields). For
 * multiple isolated origins/credential-sets, use {@link createFetch} instead.
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
  defaultStore.configure(newConfig);
}

/** Reset the global fetch config to empty. @internal Test-only. */
export function resetFetchConfig(): void {
  defaultStore.reset();
}

/** Read the current global fetch config. @internal Used by request.ts. */
export function getFetchConfig(): FetchConfig {
  return defaultStore.get();
}
