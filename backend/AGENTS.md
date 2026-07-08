# backend/ — edge API structure

Follow this layout for **all new API work**. Do not add new `/api/*` handlers as inline functions in `worker.js`.

## Layers

| Layer | Folder | Responsibility |
|-------|--------|----------------|
| **Route** | `routes/` | Match path/method, parse params, call service, return `Response` |
| **Service** | `services/` | Business rules, orchestration, no raw `Request` parsing |
| **Adapter** | `adapters/` | Upstream fetch, `env.ASSETS`, `caches.default`, secrets |
| **Schema** | `schemas/` | Validate query/body (Zod when introduced) |
| **HTTP** | `http/` | `jsonResponse`, CORS preflight — shared response shape |
| **Pure** | `../lib/` | Math, URL rewrite, thresholds — **must have Vitest tests** |

## Route handler template

```javascript
// backend/routes/example.js
import { jsonResponse } from "../http/response.js";
import { getExample } from "../services/example.js";

export const exampleRoute = {
  name: "example",
  methods: ["GET"],
  test: (url) => url.pathname === "/api/example",
  async handle({ request, env, url }) {
    const data = await getExample(env, url.searchParams);
    return jsonResponse(data, { cacheSeconds: 60 });
  },
};
```

## Service template

```javascript
// backend/services/example.js
import { loadTodayMatches } from "../adapters/assets.js";

export async function getExample(env, params) {
  const matches = await loadTodayMatches(env);
  return { count: matches.length };
}
```

## Rules

- One route file per feature area (`memes.js`, `replay.js`, `poll.js`).
- Services are **classes optional** — plain exported functions are fine at this scale.
- When migrating from `worker.js`, move the handler to `routes/`, logic to `services/`, fetch to `adapters/`.
- Run `npm test` after changing `lib/` or pure service helpers.
