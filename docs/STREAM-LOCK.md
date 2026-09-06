# Production Stream Lock

<!-- CHATGPT-STAMP 2026-09-06T14:33-04:00 — PRODUCTION-STREAM-LOCK-1 -->

Production playback is frozen at the known-good state established by commit
`8fe04a34667a75637d20bb46c4072a9925ab573c`.

This does **not** freeze the repository. Content, SEO, match data, editorial work,
styles, and unrelated application work can continue normally. The lock only
protects the files that can change the IPTV Lab, KoraZero Live/watch playback,
MPEG-TS/HLS recovery, Xtream media path, stream-plan implementation, Worker
routing, or Cloudflare playback deployment configuration.

## Approved playback split

- **IPTV Lab:** frontend restored exactly to Claude fix 1 (`7ef58247...`).
- **KoraZero Live/watch:** d69 continuity state, including `KZ_LIVE_TS_CONFIG`
  and the watch-only reconnect-on-drain/end guard.
- **Saudi automatic broadcast refresh:** remains paused; manual dispatch only.

## Enforcement

`scripts/verify-stream-lock.mjs` stores exact Git-blob fingerprints for the
approved playback files. It runs:

1. in the dedicated **Stream Lock** GitHub Actions check;
2. before and after `npm run refresh:matches`, which is the Cloudflare Workers
   Builds build command;
3. immediately before the repository's local Cloudflare deploy wrapper calls
   `wrangler deploy`.

Any missing or changed protected file exits non-zero, so the Cloudflare build
never reaches its deploy step.

Workers Builds are also fail-closed: a non-`main` branch, a stale `main` build,
or a build that cannot prove its HEAD is the current `origin/main` is refused.

## Intentional streaming change

Streaming may be changed only as planned work:

1. Copy `config/stream-change-plan.example.json` to
   `config/stream-change-plan.json`.
2. State the reason, the exact protected files allowed to change, and an expiry
   no more than 24 hours away.
3. Test the proposed playback change outside the production auto-deploy path.
4. For a deliberate deployment only, set:
   `KZ_STREAM_CHANGE_APPROVED=YES_I_INTEND_TO_CHANGE_PRODUCTION_STREAMING`.
5. After validation, update the known-good fingerprints/baseline deliberately,
   remove the temporary plan, and remove the approval variable.

A commit message, bot action, data refresh, or ordinary CI pass is never an
unlock signal.

## Rollback

If the lock infrastructure itself causes a deployment problem, production
playback remains on the last successfully deployed Worker version. Reverting the
lock commit restores the prior deployment plumbing without changing the
`8fe04a34` protected playback files.
