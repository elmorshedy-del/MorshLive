# Backend engineering guide

How a **real backend engineer** would organize Korazero — and which GitHub templates to steal from.

## The problem today

`worker.js` is ~5,500 lines: routing, HTML rewriting, Twitch, memes, replay, streams, and diagnostics in one file. That is why bugs hide and AI edits break unrelated features.

## Target architecture

```
                    ┌─────────────────────────────────┐
                    │  worker.js (entry, shrinking) │
                    │  export default { fetch }     │
                    └───────────────┬─────────────────┘
                                    │
                    ┌───────────────▼─────────────────┐
                    │  backend/router.js              │
                    │  match method + path → handler  │
                    └───────────────┬─────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
   backend/routes/          backend/services/         backend/adapters/
   (thin HTTP handlers)     (business logic)          (fetch, ASSETS, cache)
          │                         │                         │
          └─────────────────────────┼─────────────────────────┘
                                    ▼
                              lib/ (pure, tested)
```

Same layers as **Clean Architecture** / **Hexagonal** / **Zetsu (Hono)** — names differ, idea is identical:

| Layer | Classic name | Our folder | Job |
|-------|--------------|------------|-----|
| Outer | Controller / Route | `backend/routes/` | HTTP in → call service → HTTP out |
| Middle | Use case / Service | `backend/services/` | Rules, orchestration |
| Outer | Repository / Gateway | `backend/adapters/` | Talk to Twitter, Vortex, JSON files |
| Core | Entity / Domain | `lib/` | Pure functions, no I/O |

**Rule:** dependencies point **inward**. Routes depend on services; services depend on `lib/` and adapters; `lib/` depends on nothing.

## GitHub templates worth studying

### Edge / Cloudflare (closest to us)

| Repo | Stars | What to copy |
|------|-------|--------------|
| [enytc/zetsu](https://github.com/enytc/zetsu) | Production Hono template | `routes/` → `implementations/` → `services/`, Zod schemas, Vitest |
| [cloudflare/templates](https://github.com/cloudflare/templates) | Official | Hono + Workers patterns, wrangler layout |
| [nicolasdelrosario/hono-cloudflare-hexagonal-architecture](https://github.com/nicolasdelrosario/hono-cloudflare-hexagonal-architecture) | Hexagonal TS | `domain/` / `application/` / `infrastructure/` split |

### Classic Node (concepts transfer to Workers)

| Repo | What to copy |
|------|--------------|
| [javiertelioz/clean-architecture-nodejs](https://github.com/javiertelioz/clean-architecture-nodejs) | Folder anatomy, controller → use case flow |
| [panagiop/node.js-clean-architecture](https://github.com/panagiop/node.js-clean-architecture) | Express example of Uncle Bob layers |

### AI discipline (not runtime)

| Resource | What to copy |
|----------|--------------|
| [agents.md](https://agents.md/) | Root `AGENTS.md` + nested per folder |
| [Taiizor/agents-md-cookbook](https://github.com/Taiizor/agents-md-cookbook) | Templates + `agents-md-lint` |

## Migration plan (incremental)

Do **not** rewrite 5k lines at once. Order by pain:

1. ✅ **Router + `/api/health`** — pattern in place (`backend/`)
2. **Memes API** (~1,300 lines) → `services/memes-home.js`, `routes/memes.js`
3. **Replay/highlight** → `services/replay.js`, `adapters/vortex.js`
4. **Stream proxies** — keep HTML-heavy code in `worker.js` or `adapters/stream-html.js` longer
5. **Optional:** adopt [Hono](https://hono.dev) later — `backend/router.js` maps 1:1 to `app.route()`

Each migration step: extract → add test for pure parts → register route → delete duplicate from `worker.js`.

## Scripts pipeline (Node, not Worker)

`scripts/` is the **batch backend** — same ideas, different runtime:

```
scripts/
├── fetch-matches.js      # CLI entry (like routes/index)
├── *-lib.js              # services (CJS)
└── lib/*.mjs             # adapters for crawlers
```

See `scripts/AGENTS.md`. Long-term: share `lib/` between Worker and scripts.

## Checklist before merging backend changes

- [ ] New logic in `services/` or `lib/`, not inline in `worker.js`
- [ ] Pure functions have Vitest tests
- [ ] Route registered in `backend/routes/index.js`
- [ ] `npm test && npm run lint` pass
- [ ] `AGENTS.md` updated if boundaries change

## Optional upgrades (when ready)

| Tool | Purpose |
|------|---------|
| [Hono](https://hono.dev) | Typed router + middleware on Workers |
| [Zod](https://zod.dev) | Schema validation in `backend/schemas/` |
| [@cloudflare/vitest-pool-workers](https://developers.cloudflare.com/workers/testing/vitest-integration/) | Integration tests for routes |

We stay on plain JS until TypeScript migration is explicitly requested.
