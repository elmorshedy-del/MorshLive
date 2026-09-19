---
name: add-football-competition
description: Add or enable a football league, cup, qualifier, tournament, or selected competition in KoraZero/MorshLive fixtures. Use whenever a user asks to add a competition to fixtures, normalize a new football feed, whitelist a tournament, or make a league appear in the schedule.
---

# Add a football competition to MorshLive

This is the canonical procedure for adding a football league or tournament to KoraZero.

Do not rediscover the architecture from scratch. Do not add a competition by editing one file and hoping the rest of the fixture stack follows it. The fixture path has three synchronized registries plus localization and tests. A change is complete only when all required surfaces agree and the verification gates below pass.

## Read first

Before editing:

1. Read the repo-root `AGENTS.md`.
2. Read `scripts/AGENTS.md` because the shared Node fixture normalizer lives in `scripts/`.
3. Read `backend/AGENTS.md` because the scoreboard allowlist lives in `backend/`.
4. Inspect the most recent competition-addition commits if the surrounding code changed since this skill was written.
5. Work from the current `main`, not a stale feature branch.

Never skip repository instructions in favor of this skill. This skill is the competition-specific layer on top of them.

## Architecture invariant

A competition supported by the normal ESPN fixture flow must exist in all three places below, in the same relative order.

| Surface | File | What it controls |
| --- | --- | --- |
| Shared Node registry | `scripts/matches-lib.js` → `COMPETITIONS` | Match generation, normalization, TheSportsDB fallback aliases, audience filtering |
| Browser registry | `assets/js/matches-api.js` → `COMPETITIONS` | Live browser fixture fetch and normalization |
| Backend allowlist | `backend/services/football.js` → `FOOTBALL_LEAGUES` | Which ESPN scoreboards and summaries the Worker may fetch |

The Node registry is the semantic reference. The browser registry intentionally mirrors it because this site is plain browser JavaScript, not a bundled shared-module application. The backend list is the flattened ESPN slug allowlist.

`tests/football-competition-parity.test.js` enforces this invariant in CI. It compares:

- competition `key`
- Arabic label `nameAr`
- ESPN slugs
- provider league-name aliases
- `teamWhitelist`
- `audienceGroups`
- flattened backend ESPN allowlist
- uniqueness of keys, slugs, and aliases

If that test fails, fix the registry drift. Do not weaken or delete the test to make CI green.

## Required inputs

Derive these from current provider evidence and the user's requested scope. Do not ask the user to supply values that can be established from the providers.

Record the values before implementation:

| Field | Meaning |
| --- | --- |
| `key` | Stable internal lowercase identifier, e.g. `gulfcup`, `afconq`, `ligue1` |
| `name` | Canonical English display/provider name used by Node |
| `nameAr` | Natural Arabic competition name |
| `espnSlugs` | Exact ESPN soccer slug or slugs |
| `leagueNames` | Exact provider competition-name aliases that should normalize to this key |
| scope | Full competition, selected teams, or audience-group filtered |
| participants | Every club/national team that can appear in the requested visible scope |
| channel policy | Normally unchanged; special handling only when evidence requires it |

The internal `key` is stable application data. Do not rename an existing key casually because cached/generated match objects may already carry it.

## Phase 1 — establish the source, do not guess it

### 1. Verify that ESPN actually exposes the competition

The normal fixture path is ESPN-backed. Never invent a slug from the tournament name.

Search current sources, then directly probe the candidate scoreboard endpoint:

```bash
curl -fsS \
  "https://site.api.espn.com/apis/site/v2/sports/soccer/<SLUG>/scoreboard?dates=<YYYYMMDD>&limit=100"
```

Use dates that actually overlap the competition. For a future tournament, use its scheduled dates rather than today's date.

A valid slug should produce a JSON scoreboard response whose league identity is consistent with the requested competition. Prefer direct response evidence over a search-result snippet.

### 2. Confirm schedule reality

Also verify the tournament/league is current and the expected dates or season are real using a reputable current source. For a tournament, verify the start/end dates and participant field. For a league, verify the current season and teams in scope.

This prevents adding an obsolete similarly named competition or the wrong edition.

### 3. Fail closed when ESPN does not support it

If no real ESPN slug can be verified:

- do **not** invent one;
- do **not** add a fake backend allowlist entry;
- do **not** pretend a TheSportsDB-only registry entry will work reliably in the current browser flow.

The current browser falls back to TheSportsDB only when ESPN yields no matches at all, so a TheSportsDB-only competition can be starved whenever any ESPN competition returns fixtures.

If ESPN support is absent, the task has changed from "add a competition" to "add a new fixture-source path." That requires an explicit architecture change and separate tests.

## Phase 2 — decide visibility policy before coding

Choose exactly one policy.

### Full competition

Use no `teamWhitelist` and no `audienceGroups`. Every fixture from that competition is eligible for display.

Use this for a tournament the user wants in full, such as the Arabian Gulf Cup.

### Selected teams only

Use `teamWhitelist` when the competition should appear only if one of a known set of clubs/teams is involved.

Example pattern:

```js
teamWhitelist: ["Paris Saint-Germain", "Paris Saint Germain", "Paris SG", "PSG"],
```

Do not use a whitelist merely because a league is large. It is product policy, not an optimization.

### Audience-group filtered

Use `audienceGroups` for international feeds where only audience-relevant national teams should be visible.

Current groups are defined through `assets/js/team-names.js` national-team metadata, such as:

- `north_africa`
- `gcc`
- `priority_latam`

If the filter depends on a team being in a group, that team must resolve through the national-team registry. A plain English→Arabic translation is not enough.

### Policy test requirement

Any new `teamWhitelist` or `audienceGroups` rule requires a dedicated test with:

- at least one fixture that must be included;
- at least one fixture that must be excluded;
- aliases where alias behavior is material.

A policy with no positive and negative regression example is incomplete.

## Phase 3 — write red tests before implementation

Tests should establish the desired behavior before the registries are changed.

At minimum update these:

### `tests/matches-leagues.test.js`

Add:

1. the new ESPN slug(s) to the expected `ESPN_LEAGUES` order;
2. one or more `competitionForLeagueName(...)` assertions;
3. a realistic `normalizeEspnEvent(...)` case that asserts:
   - ESPN-derived id format;
   - `competition` key;
   - `league` name;
   - `leagueAr`;
   - `leagueSlug`;
   - home/away identity.

The event can be a minimal fixture object, but the names and slug must be realistic.

### `tests/football-route.test.js`

Add the slug(s) to the exact expected backend league list and update the expected upstream request count.

This proves the Worker will actually fetch the competition rather than merely knowing how to normalize it.

### Competition-specific behavior test

Create or extend a focused test when any of these apply:

- `teamWhitelist`
- `audienceGroups`
- special channel behavior
- unusual provider aliases
- participant-localization requirements
- multiple ESPN slugs that collapse into one internal competition

### Prove the tests are red

Before implementation, run the targeted tests:

```bash
npm test -- \
  tests/matches-leagues.test.js \
  tests/football-route.test.js \
  tests/football-competition-parity.test.js
```

Expected result before implementation: failure for the missing competition behavior.

**PASS (red phase):** at least one assertion fails for the exact missing slug/mapping/allowlist behavior you are about to add.

**FAIL (red phase):**

- all new tests already pass before implementation;
- the failure is unrelated syntax/setup noise;
- the test only checks a string exists and does not prove the fixture path;
- the test was weakened to fit existing behavior.

If a new test passes before implementation, it is not protecting the change. Fix the test.

## Phase 4 — implement all synchronized registries

### A. Shared Node registry

Edit `scripts/matches-lib.js` → `COMPETITIONS`.

Normal full-competition shape:

```js
{
  key: "<internal-key>",
  name: "<canonical English name>",
  nameAr: "<Arabic competition name>",
  espnSlugs: ["<exact ESPN slug>"],
  leagueNames: ["<provider name>", "<provider alias if verified>"],
},
```

Optional fields:

```js
teamWhitelist: ["..."],
audienceGroups: ["..."],
```

Only add provider aliases you have a reason to support. Do not generate speculative spellings.

### B. Browser registry

Mirror the same competition in `assets/js/matches-api.js` → `COMPETITIONS`, in the same position.

The browser shape normally omits Node's `name`, because the browser currently derives the league name from the ESPN payload:

```js
{
  key: "<internal-key>",
  nameAr: "<same Arabic label>",
  espnSlugs: ["<same slug>"],
  leagueNames: ["<same aliases>"],
},
```

Copy `teamWhitelist` and `audienceGroups` exactly when present.

Do not manually update the browser's `ESPN_LEAGUES`; it is derived from `COMPETITIONS`.

### C. Backend ESPN allowlist

Edit `backend/services/football.js` → `FOOTBALL_LEAGUES`.

Add every new ESPN slug in the exact flattened order produced by the Node registry.

For a one-slug competition:

```js
"<exact ESPN slug>",
```

For a multi-slug competition, preserve the order in `espnSlugs`.

The generic parity test will fail if the backend order or contents differ from the Node registry.

## Phase 5 — normalize provider names and Arabic team names

### Competition aliases

`leagueNames` matters to the TheSportsDB normalization path via `competitionForLeagueName`.

Use the provider's actual names, not a list of imagined variants.

### Team localization

KoraZero is Arabic-first. Every team that can appear in the newly visible scope should have a verified Arabic display path.

Check each current participant/opponent:

```js
TeamNames.arabicFor("<provider team name>")
```

If a visible team is unresolved, add it to `assets/js/team-names.js`.

For static/SEO consumers that read the JSON lookup, mirror required explicit entries in:

`assets/data/team-names-ar.json`

Do not assume the two files have historically been perfect mirrors; add the entries required by the new visible scope and verify them.

### National-team audience metadata

If `audienceGroups` depends on the new team, add/adjust the team's entry in `NATIONAL_TEAM_REGISTRY` in `assets/js/team-names.js`.

Example:

```js
{ name: "Saudi Arabia", ar: "السعودية", aliases: ["Saudi", "KSA"], groups: ["gcc"] },
```

Do not add teams to an audience group simply because they participate in a tournament. Group membership is audience policy.

### Localization test

For a finite tournament or whitelist, add a regression test that iterates the full requested participant/opponent set and asserts `TeamNames.arabicFor(name)` resolves.

A passing tournament-localization test means every expected visible participant has a non-empty Arabic value.

## Phase 6 — do not invent broadcast routing

Adding a fixture competition is not permission to invent a broadcaster or stream.

Preserve existing channel behavior unless there is concrete evidence and the user asked for routing/binding work.

Do not:

- guess that a tournament is on beIN because other competitions are;
- hard-code a new `channelId` without evidence;
- touch locked playback files merely to make the fixtures appear;
- probe IPTV streams as part of competition registration.

If the new competition needs a special "display-only until hydrated" rule, make that a deliberate tested behavior, as was done for PSG-only Ligue 1. Otherwise do not create a special case.

## Phase 7 — mandatory machine-enforced parity gate

Run:

```bash
npm test -- tests/football-competition-parity.test.js
```

This test is intentionally broader than the current change.

**PASS:**

- browser and Node competition metadata are identical for all semantic fields;
- backend allowlist equals flattened Node ESPN slugs;
- no duplicate competition key;
- no duplicate ESPN slug;
- no duplicate normalized league alias.

**FAIL:**

- a competition exists in only one or two registries;
- one surface has different aliases, Arabic name, whitelist, or audience groups;
- backend forgot one slug;
- ordering differs;
- a duplicate key/slug/alias was introduced;
- the browser registry structure changed and the test can no longer inspect it.

When the final case occurs, update the parity test to the new architecture in the same change. Never delete the invariant.

## Phase 8 — verification matrix

All applicable rows must pass.

| Gate | Command / evidence | PASS | FAIL |
| --- | --- | --- | --- |
| Upstream identity | direct ESPN scoreboard/schedule evidence | exact real slug and competition identity confirmed | slug inferred, guessed, or unsupported |
| Red tests | targeted Vitest before implementation | fails for intended missing behavior | passes before change or fails for unrelated reason |
| Registry parity | `npm test -- tests/football-competition-parity.test.js` | exit 0 | any mismatch |
| League normalization | `tests/matches-leagues.test.js` | alias + normalized sample assertions pass | key/name/Arabic/slug wrong |
| Backend fetch allowlist | `tests/football-route.test.js` | slug appears; request count correct | API never fetches it |
| Visibility policy | dedicated test if filtered | positive + negative fixtures correct | wrong teams leak or intended teams disappear |
| Arabic localization | participant test / direct assertions | every required visible team resolves | raw untranslated required team remains |
| Lint | `npm run lint` | exit 0 | any Biome error |
| Targeted tests | targeted Vitest command | exit 0 | any failure |
| Stream safety | `npm run verify:stream-lock` | exit 0 | playback lock changed unexpectedly |
| Full suite | `npm test` | exit 0 | any regression |
| Diff scope | `git diff --check` + review diff | focused competition/test/localization changes | unrelated refactor or generated churn |
| CI | GitHub CI + Stream Lock | green | pending/failed/cancelled |
| Production | live football scoreboard after merge | new slug succeeds and fixtures appear when scheduled | live worker still lacks the competition |

No "mostly green." Any required failed gate means the task is not done.

## Phase 9 — inspect the diff before opening the PR

The normal competition-addition diff should be small and explainable.

Expected files are usually a subset of:

- `scripts/matches-lib.js`
- `assets/js/matches-api.js`
- `backend/services/football.js`
- `assets/js/team-names.js`
- `assets/data/team-names-ar.json`
- `tests/matches-leagues.test.js`
- `tests/football-route.test.js`
- one focused competition/audience/localization test

Unexpected changes to player/stream code are a red flag.

Do not regenerate large data files unless the task specifically requires regenerated fixture output and the repo instructions permit it.

## Phase 10 — PR, CI, merge

Follow the root Git workflow.

1. Branch from latest `main`.
2. Prefer a test-first commit followed by implementation, when practical.
3. Run all local verification gates.
4. Open a focused PR.
5. Wait for GitHub CI and Stream Lock to complete.
6. If either fails, inspect the real failure and fix it; do not merge around it.
7. When requested work is complete and CI is green, merge the PR. Do not leave a finished PR for the user to merge.

The PR body should state:

- verified upstream slug(s);
- competition scope;
- files/surfaces updated;
- localization coverage;
- targeted/full test results;
- whether channel behavior changed (normally "no").

## Phase 11 — post-merge production verification

A merge is not the same thing as production proof.

After merge, verify the live Worker with a date range that includes real fixtures:

```bash
curl -fsS \
  "https://korazero.com/api/football/scoreboard?dates=<YYYYMMDD>-<YYYYMMDD>"
```

Verify:

1. the new slug is present in the successful `leagues` rows;
2. it is not unexpectedly listed under `unavailable`;
3. when fixtures are scheduled in the range, the returned payload contains them;
4. names/teams normalize correctly in the site path.

If production is still serving the pre-merge code, follow `AGENTS.md` production-freshness instructions and deploy rather than treating an in-flight build as success.

Do not use IPTV stream probes to verify a fixture-registration change.

## Special cases

### One internal competition, multiple ESPN slugs

Use one `COMPETITIONS` object with multiple `espnSlugs` when the product should treat the feeds as one competition.

Example pattern:

```js
espnSlugs: ["uefa.champions", "uefa.champions_qual"],
```

Backend must contain both in the same order.

### Provider has multiple English league names

Put verified variants in `leagueNames`. The internal `key` and Arabic name remain one identity.

### Club competition shown for only one team

Use `teamWhitelist` and write both inclusion and exclusion tests. Do not fetch a different source just to avoid filtering.

### International feed shown only to KoraZero audience segments

Use `audienceGroups` and ensure aliases resolve through `NATIONAL_TEAM_REGISTRY`. Test both an allowed and disallowed fixture.

### Future tournament with no event on today's scoreboard

Query the actual tournament dates. Empty "today" results are not evidence that the slug is invalid.

### Tournament has not published its complete field

Do not invent participants. Localize confirmed teams now and add later teams when the field is official. The competition can still be added if its source identity is verified.

### ESPN returns a valid slug but a different canonical league label

Use the actual ESPN identity for `name`/aliases and the user's desired natural Arabic label for `nameAr`. Do not rename the ESPN slug.

## Common failure modes this skill is designed to prevent

### "I added it to matches-lib, so it should work"

Wrong. Browser live fetch or backend allowlisting can still omit it. Registry parity must pass.

### "I found a likely ESPN slug"

Likelihood is not enough. Probe it.

### "Tests are green"

Green tests are insufficient if the new tests were never red first or do not exercise backend fetching and normalization.

### "The tournament exists but no matches show"

Check, in order:

1. actual ESPN slug and date window;
2. backend `FOOTBALL_LEAGUES`;
3. Node/browser registry parity;
4. visibility policy filtering;
5. production Worker freshness.

Do not jump to stream/player code.

### "One team is still in English"

That is a localization defect, not harmless cosmetics on an Arabic-first site. Add the missing provider spelling/alias and a regression assertion.

### "The card points to the wrong channel"

Fixture registration and broadcast binding are different problems. Do not solve it by guessing a channel inside the competition registry.

## Minimal implementation template

### Node

```js
{
  key: "examplecup",
  name: "Example Cup",
  nameAr: "كأس المثال",
  espnSlugs: ["global.example_cup"],
  leagueNames: ["Example Cup"],
},
```

### Browser

```js
{
  key: "examplecup",
  nameAr: "كأس المثال",
  espnSlugs: ["global.example_cup"],
  leagueNames: ["Example Cup"],
},
```

### Backend

```js
"global.example_cup",
```

### Normalization assertion

```js
expect(match).toMatchObject({
  competition: "examplecup",
  leagueAr: "كأس المثال",
  leagueSlug: "global.example_cup",
});
```

These are templates only. Never copy the placeholder slug or names into real code.

## Definition of done

A league/tournament addition is **PASS** only when every statement below is true:

- [ ] exact current upstream competition identity and slug were verified;
- [ ] requested visibility policy is explicit;
- [ ] targeted tests were written and shown red before implementation;
- [ ] Node registry updated;
- [ ] browser registry updated;
- [ ] backend ESPN allowlist updated;
- [ ] provider league aliases are verified, not invented;
- [ ] required visible teams have Arabic localization;
- [ ] filtered competitions have positive and negative policy tests;
- [ ] `tests/football-competition-parity.test.js` passes;
- [ ] targeted competition tests pass;
- [ ] `npm run lint` passes;
- [ ] `npm run verify:stream-lock` passes;
- [ ] full `npm test` passes;
- [ ] diff has no unrelated changes;
- [ ] GitHub CI is green;
- [ ] GitHub Stream Lock is green;
- [ ] PR is merged;
- [ ] live production scoreboard is checked after merge.

If any required box is false, report the task as incomplete rather than saying the competition was added successfully.

## Final report format

Keep the user-facing report concise, but it must contain the evidence needed to trust the change:

```text
Added: <competition>
Source: ESPN <slug>, verified for <date/season>
Scope: <full / whitelist / audience-filtered>
Normalization: Node + browser + backend aligned
Localization: <coverage summary>
Tests: targeted PASS; parity PASS; lint PASS; stream lock PASS; full suite PASS
CI: PASS
Merged: PR #<n>, <merge SHA>
Production: <verified / exact blocker>
```

Do not claim PASS for a check you did not actually run.
