# Contributing to fetch

`@cplieger/fetch` is a zero-dependency, vanilla-TypeScript `fetch` wrapper
published to both npm and JSR. This guide covers the bits that aren't obvious
from reading the source. For org-wide defaults not repeated here, see the
[fallback contributing guide](https://github.com/cplieger/.github/blob/main/CONTRIBUTING.md).

## Architecture

The library is a handful of small, single-purpose modules under `src/`, each
paired with a colocated `*.test.ts`:

- `types.ts`: pure types, no imports, no runtime: `HttpMethod`, `Decoder`,
  `FetchConfig`, `ApiOk` / `ApiErr` / `ApiResult`, `RequestOptions`. Any module
  may depend on it.
- `timeout.ts`: `withTimeout` (composes a caller signal with
  `AbortSignal.timeout` via `AbortSignal.any`) and the `API_TIMEOUT_MS`
  default. The single timeout-composition implementation;
  `@cplieger/actions` imports it from here.
- `request.ts`: the core. `makeRequestRaw(cfg)` builds a config-bound
  `requestRaw` (builds the request, runs the fetch, resolves to an `ApiResult`)
  over an immutable `FetchConfig`; `makeRequest` wraps it into the
  null-collapsing `request`. These are config-parametrized factories, assembled
  per instance in `instance.ts`.
- `verbs.ts`: `makeVerbs(request, requestRaw)` builds the 12 thin per-verb
  helpers (`apiGet`, `apiGetRaw`, `apiGetTyped`, …) bound to a request pair.
- `instance.ts`: the single assembly site. `createFetch(config?)`
  shallow-copies and freezes the config, then composes `makeRequestRaw` /
  `makeRequest` / `makeVerbs` into a `FetchInstance` (its own `requestRaw` /
  `request` / 12 verbs). Instances are the only configuration surface: two
  instances share nothing, there is no module-global default, and a changed
  backend produces a new instance.

The public API is whatever `src/index.ts` re-exports; that file is the
contract. Update it deliberately, and keep the README `## API` section in sync.

### Invariants (protect these)

- **`requestRaw` never throws.** Every failure mode is a returned `ApiErr`,
  never an exception: a build-phase throw (an un-encodable body, a bad header or
  `timeoutMs`, a throwing `prepareHeaders`) becomes `code: "invalid"`; a thrown
  fetch error is classified (`cancelled` when the caller signal is aborted, else
  `timeout` for a `TimeoutError` / `AbortError`, else `network`); a non-2xx
  response becomes an `ApiErr` with the lifted `error` / `code` / `request_id`;
  and a `JSON.parse` or decoder throw becomes `code: "decode"`. `request` and
  the null-collapsing verb helpers derive from
  this by returning `null` on any non-`ok` result. The tests pin every branch;
  do not let a refactor turn a returned error back into a throw.
- **Status `0` means a pre-response failure.** `network`, `timeout`,
  `cancelled`, and the build-phase `invalid` errors all carry `status: 0`; a
  lifted server error carries the real HTTP status, and a `decode` error carries
  the real 2xx status. `ApiErr.headers` follows the same line: present exactly
  when a real HTTP response was received (any non-2xx, or a 2xx decode
  failure), absent on every status-0 failure. Success envelopes never carry
  headers.
- **The relative-path contract.** With `baseUrl` set, the base scheme+host
  always precede `path` (one slash at the join, no origin override); with
  `baseUrl` unset, `path` is passed to `fetch()` verbatim. See the README path
  contract note.
- **Zero runtime dependencies.** `package.json` `dependencies` is empty and
  stays empty: everything is built on the platform `fetch` / `Headers` /
  `AbortSignal`. Decoder combinators and a retry/interceptor layer are
  [out of scope](README.md#unsupported-by-design); do not add them here.
- **Config is immutable and instance-scoped.** `createFetch` shallow-copies and
  freezes its config; there is no module-global default, no post-construction
  mutation, and no `configure` method. Do not reintroduce any of them (the v1
  global surface was deliberately removed in v2): a changed backend is a new
  instance, and late-bound per-request state (a token acquired after boot)
  belongs inside the `prepareHeaders` hook, which runs on every call.
- **Neutralize, not reject.** The path contract defuses navigation syntax and
  still sends the request; a pre-network `code: "invalid"` rejection was
  evaluated and declined. Do not re-propose it
  without a real cross-origin consumer.

## Public API surface

`src/index.ts` is the entire public surface, wired into `package.json`
`exports` and `jsr.json` `exports` (both point at `./src/index.ts`). Anything
new that consumers should reach must be re-exported there, and the README `##
API` list updated to match.

## Local development

Install dev dependencies, then run the checks (scripts are in `package.json`):

```sh
npm install
npm run typecheck         # tsc -project tsconfig.json (source)
npm run typecheck:tests   # tsc -project tsconfig.test.json (incl. tests)
npm test                  # vitest --run
npx eslint .              # strict typed lint (eslint.config.mjs)
npx prettier --check .    # formatting (printWidth 100)
```

The `typecheck` scripts run `tsc`, the TypeScript 7 native compiler. It comes
from the `@typescript/native` devDependency (an npm alias for `typescript@7`),
which `npm install` places at `node_modules/.bin/tsc`; no separate install
step. (The `typescript` devDependency is aliased to `@typescript/typescript6`,
the TS 6.x API `typescript-eslint` needs; its bin is `tsc6`, so it never shadows
the native `tsc`.) There is no build step: the package ships TypeScript source
directly (both npm and JSR reference `src/**/*.ts`), so consumers compile it
through their own bundler.

## Conventions and gotchas

- **`.js` import extensions in TypeScript.** Relative imports use a `.js`
  suffix (e.g. `import { requestRaw } from "./request.js"`) even though the
  files are `.ts`. This is required by the `"moduleResolution": "bundler"` ESM
  setup; matching the existing style is mandatory or the resolution breaks.
- **Strict compiler.** `tsconfig.json` enables `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`,
  `noImplicitOverride`, and friends, which is why `ApiErr` is built by
  conditionally assigning `code` / `requestId` rather than passing `undefined`.
- **Strict typed ESLint.** `eslint.config.mjs` runs the `strictTypeChecked` and
  `stylisticTypeChecked` presets: no `any` (prefer `unknown`), inline `import
type`, `eqeqeq`, `curly`, `prefer-const`. Prefix deliberately unused names
  with `_`.
- **Tests are colocated** as `src/**/*.test.ts` (the only pattern vitest
  includes), with the property suite in `src/*.property.test.ts` via
  `fast-check`. Build a fresh `createFetch({ fetchFn })` instance per test with
  a stubbed `fetchFn` rather than hitting the network: instances share
  nothing, so there is no global state to reset between tests.
- **DOM tests** run under `happy-dom` (via the `// @vitest-environment
happy-dom` pragma), so `Response` / `Headers` / `AbortSignal` are available in
  tests without a browser.
- **Don't edit `.github/workflows/*`.** `ci.yaml` and `release.yaml` are synced
  from `cplieger/ci` and marked DO NOT EDIT; behavior changes belong upstream.

## Publishing

Releases are automated. A push to `main` runs the centralized release workflow,
which computes the next version from commit history via git-cliff and publishes
to both npm and JSR. Keep `version` in `package.json` and `jsr.json`
consistent; never hand-cut a release locally.

## Commits and PRs

Branch from `main`, keep changes focused with tests, and open a PR. Commits
follow [Conventional Commits](https://www.conventionalcommits.org/) parsed by
git-cliff: `feat:` → minor, `fix:` / `sec:` → patch/security, `feat!:` or
`BREAKING CHANGE:` → major, and `chore` / `ci` / `docs` / `test` / `style` /
`refactor` don't trigger a release (see `cliff.toml`). Renovate devDependency
bumps use `chore(devdeps)` and are intentionally skipped.

## Conduct & security

By participating you agree to the
[Code of Conduct](https://github.com/cplieger/.github/blob/main/CODE_OF_CONDUCT.md).
Report vulnerabilities through the
[security policy](https://github.com/cplieger/.github/blob/main/SECURITY.md),
never in a public issue.
