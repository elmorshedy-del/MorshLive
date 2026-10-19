# Match Intelligence Center — source plan and release gates

## Already implemented
- The existing KoraZero ESPN match objects supply match, score, goal events and team statistics.
- The interactive minute scrubber reconstructs recorded goals; statistics are clearly labeled as cumulative and are not incorrectly rewound.
- The center hides when no match has detailed coverage; no fabricated numbers or win probabilities.

## Opt-in Sportradar integration
- Dedicated route: /api/match-intelligence?srid=sr:sport_event:123
- Cloudflare Worker secret: SPORTRADAR_API_KEY (never in GitHub or browser)
- Explicit public redistribution permission flag: SPORTRADAR_PUBLIC_DISPLAY_ENABLED=true (default disabled)
- Access level optional: SPORTRADAR_ACCESS_LEVEL=production (otherwise trial)
- Adapters consume soccer v4 timeline events and soccer-extended v4 minute-by-minute momentum.
- ESPN fixture IDs are NOT Sportradar IDs. Persist validated mapping by team/league/kickoff before live activation.
- Sportradar momentum (-50 home advantage, +50 away advantage) is NOT a win probability.
- Probabilities is a separately licensed add-on; do not estimate win percentages from possession.
- An external ingestion/cache fan-out is required before enabling the public display flag. Trial quotas are commonly just 1,000 requests per 30 days and 1 query/second. Never let every browser independently hit Sportradar.
- Check paid/commercial public display rights before re-publishing any provider data.

## Next data needed
1. Confirm which Sportradar subscriptions the server-side key can access: Soccer, Soccer Extended momentum, Probabilities.
2. Central polling/stream collection and a persistent ESPN-to-Sportradar event ID mapping.
3. Provider source timestamps, coverage flags, and optional shot locations. xG can only be shown if returned by an authorized provider.
4. Store the secret directly in Cloudflare Worker secrets. The deployment tool refused the direct secret write in this session, so none was installed.

## Preview
A standalone worker serves two historical ESPN match samples, not a live feed and not Sportradar-derived values:
https://korazero-intelligence-preview-20261019.elmorshedy.workers.dev/
