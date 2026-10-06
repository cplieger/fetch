# Contributing to fetch

The [shared rules](https://github.com/cplieger/.github/blob/main/CONTRIBUTING.md) for commits, releases, synced files and checks apply here.

## Rules

- An export added, renamed or removed in `src/index.ts` also changes the README `## API` list. No check compares that list with the exports, so it drifts unnoticed.
- A `FetchConfig` setting added, renamed or removed also changes the README `## API` list and the settings table in `docs/requests.md`. A `RequestOptions` field changes the options table on that page.
- A library error code added or changed also changes the `code` comment in `src/types.ts`. It also changes the README `## Errors are values` section and the codes table in `docs/results.md`.
- Relative imports end in `.js`, as in `./request.js`, although the files are `.ts`. Consumers type-check this source under their own settings, where `nodenext` rejects an extensionless import. The `bundler` setting in `tsconfig.json` accepts one, so the local type check passes.
