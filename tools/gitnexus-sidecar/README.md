# KoraZero GitNexus sidecar

This is **engineering infrastructure only**. It is deployed from the isolated
`infra/gitnexus-sidecar` branch to its own Railway project and is not part of
KoraZero's production request, playback, Cloudflare, or StreamV2 path.

## Purpose

GitNexus indexes KoraZero outside the LLM context window so coding agents can
query a compact structural view before opening source files.

Indexed repositories:

- `elmorshedy-del/MorshLive` — `main`
- `elmorshedy-del/KoraZero-StreamV2` — `feature/gateway-control` (falls back to `main` if unavailable)

Both are grouped as `korazero`.

## Runtime

The Railway sidecar:

1. Clones or fast-resets both repositories over HTTPS.
2. Runs `gitnexus analyze` on each repository.
3. Repairs LadybugDB FTS once per persisted index when required.
4. Rebuilds the `korazero` group registry.
5. Repeats the sync every 5 minutes.
6. Serves authenticated GitNexus MCP on Railway's `PORT`.

Persistent state lives under `/data`, backed by a Railway volume.

## Agent workflow

Preferred order for KoraZero changes:

1. Search/query GitNexus for the subsystem or behavior.
2. Use `context`, `impact`, or `trace` to find structural neighbors and blast radius.
3. Read only the identified source locations.
4. Make the code change.
5. Run `detect_changes` / impact again where applicable.
6. Run repository tests and runtime verification.

GitNexus is a navigation and structural-awareness layer, not source-of-truth.
Runtime state, source code, tests, Cloudflare, Railway, and external APIs remain
authoritative.

## Cross-repo note

The two repositories communicate primarily over runtime HTTP boundaries rather
than source imports. GitNexus group search works across both indexes, but
automatic contract sync may not create a cross-repo ContractLink for a dynamic
HTTP client call such as the website's V2 active-state lookup. Do not invent a
manifest link merely to make the graph look connected: a declared link should
anchor to real symbols on both sides before it is treated as blast-radius
evidence.

## Configuration

Required:

- `GITNEXUS_MCP_AUTH_TOKEN`
- `GITNEXUS_HOME=/data/gitnexus`
- `KORAZERO_REPO_ROOT=/data/repos`

Operational:

- `GITNEXUS_LBUG_BUFFER_POOL_SIZE=4294967296` — MorshLive exceeds the default
  LadybugDB import pool during a full graph rebuild.
- `GITNEXUS_MCP_DEFAULT_MAX_TOKENS=6000` — keeps normal graph answers compact; agents may override the budget for a specific deep query.
- `GITNEXUS_MCP_ALLOWED_REPOS=MorshLive,KoraZero-StreamV2` — bounds the MCP
  server to the two KoraZero indexes.

Never commit the MCP auth token.
