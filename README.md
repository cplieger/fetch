# fetch

> Small, zero-dependency universal fetch wrapper for TypeScript with a typed, non-throwing result envelope.

`@cplieger/fetch` wraps the platform `fetch` with a non-throwing core: every call resolves to an `ApiResult<T>` (a discriminated `ok`/error union) instead of throwing. Zero runtime dependencies, ESM-only, published as TypeScript source.

## Install

```sh
npx jsr add @cplieger/fetch
# or
npm i @cplieger/fetch
```

## Usage

```typescript
import { configureFetch, apiGet, apiGetRaw } from "@cplieger/fetch";

configureFetch({ baseUrl: "https://api.example.com/v1" });

// Null-collapsing: data on success, null on any error.
const user = await apiGet<{ id: string }>("/users/me");

// Envelope: full status + error details, never throws.
const res = await apiGetRaw<{ id: string }>("/users/me");
if (res.ok) {
  console.log(res.status, res.data);
} else {
  console.error(res.status, res.code, res.error);
}
```

## License

GPL-3.0 — see [LICENSE](LICENSE).
