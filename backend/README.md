# Backend layout (KoraZero edge API)

This folder is the **target structure** for splitting `worker.js` into maintainable layers.
Wrangler still uses `worker.js` as entry; it delegates API routes here incrementally.

## Layers (real backend engineering, adapted for Workers)

```
backend/
├── router.js           # Route table + dispatch (like Express/Hono routing)
├── http/               # Response helpers, CORS — no business logic
├── routes/             # Thin handlers: parse request → call service → return Response
├── services/           # Business logic, orchestration (memes, replay, streams)
├── adapters/           # External I/O: fetch upstream, ASSETS, caches, secrets
├── schemas/            # Input validation (Zod when added)
└── lib/                # Re-export ../lib pure functions (optional)
```

**Dependency rule (inward only):**

```
routes → services → lib (pure)
         ↓
      adapters (fetch, ASSETS, env)
```

- `routes/` never call `fetch` directly — use a `services/` or `adapters/` function.
- `lib/` (repo root) stays **pure** — no `env`, no `fetch`. Tested with Vitest.
- `worker.js` keeps legacy stream proxies until migrated; new API work goes in `backend/`.

## Template repos this mirrors

| Repo | Pattern | Best for |
|------|---------|----------|
| [enytc/zetsu](https://github.com/enytc/zetsu) | Routes → Implementations → Services | Edge API on CF Workers + Hono |
| [nicolasdelrosario/hono-cloudflare-hexagonal-architecture](https://github.com/nicolasdelrosario/hono-cloudflare-hexagonal-architecture) | Domain / Application / Infrastructure | TypeScript hexagonal |
| [cloudflare/templates](https://github.com/cloudflare/templates) | Official CF + Hono fullstack | Greenfield Workers apps |
| [javiertelioz/clean-architecture-nodejs](https://github.com/javiertelioz/clean-architecture-nodejs) | Controllers → Use cases → Repos | Classic clean architecture |
| [panagiop/node.js-clean-architecture](https://github.com/panagiop/node.js-clean-architecture) | Same, Express + Mongo example | Learning the layers |

We use **plain JS + fetch** (no Hono yet) so migration is incremental. Hono can wrap this later.

## Adding a route

1. Add handler in `backend/routes/your-feature.js`
2. Register in `backend/routes/index.js`
3. Wire `dispatchBackendRoutes()` early in `worker.js` `fetch`
4. Put logic in `backend/services/your-feature.js` if > ~30 lines
5. Add tests for pure parts in `tests/`

See `backend/AGENTS.md` and `docs/BACKEND.md`.
