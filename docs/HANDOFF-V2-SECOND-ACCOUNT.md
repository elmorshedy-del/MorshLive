# Handoff — second V2 (Mist) IPTV account + automatic channel slots

Read this, then `AGENTS.md`, `docs/STREAM-LOCK.md`, and `docs/STREAM-PLANS.md`.
This work spans **two repositories**:

| Repo | Branch to build on | What lives there |
|------|--------------------|------------------|
| `elmorshedy-del/KoraZero-StreamV2` | `feature/gateway-control` (this is what Railway runs, **not** `main`, which is still the skeleton) | `v2-control`, `v2-iptv-relay`, `v2-mist` Railway services; the operator remote (`src/remote.html`) |
| `elmorshedy-del/MorshLive` (this repo) | branch off `main`: `cursor/<name>-f540` | The Worker gate that decides which match page may play which V2 channel; fixture → channel bindings; the new auto-assignment schedule |

**Scope:** this is about **V2 / Mist** only, meaning `https://v2-mist-production.up.railway.app/hls/iptv-<id>/index.m3u8`.
It is **not** about the old Xtream / IPTV Lab line (`IPTV_LAB_JSON`, `XTREAM_PORTALS_JSON`,
`/api/iptv-lab/*`, `/api/xtream/*`). Do not touch that path for this work.

---

## 1. Goal

Today V2 can carry **one** live channel at a time because the provider account
allows one connection. The owner is adding a **second provider account**. Done means:

1. Two different channels can be live on V2 at the same time, one per account.
2. Every match page whose channel is on either slot plays. Every other V2 match
   page holds on "waiting" exactly as today.
3. Channels are **assigned to slots automatically** from the fixture schedule. When
   more V2 matches overlap than there are slots, the **higher-priority match** wins by
   a deterministic, explainable rule (section 7).
4. The operator remote can see both slots and override either one by hand.
   A manual choice always beats automation.
5. Unsetting one Railway variable puts everything back to today's single-slot
   behaviour.

---

## 2. How V2 works today (verified Oct 17, 2026)

### Railway (KoraZero-StreamV2, `feature/gateway-control`)

```
browser ──HLS──▶ v2-mist (MistServer)  stream "iptv-<streamId>"
                     │ source = http://v2-iptv-relay.railway.internal:8080/live/<streamId>.ts
                     ▼
               v2-iptv-relay  ── one provider account (env V2_IPTV_PORTAL_URL / _USERNAME / _PASSWORD)
                     ▲
               v2-control  (server/control-server.js) — public /api/active, PIN-gated /operator/*
```

- `server/iptv-relay-core.js` reads **exactly one** account from env
  (`V2_IPTV_PORTAL_URL`, `V2_IPTV_USERNAME`, `V2_IPTV_PASSWORD`) and serves
  `/catalog`, `/account`, `/stats`, `/live/<id>.ts`.
- `server/runtime-config.js` builds **one** `catalogClient` against
  `V2_IPTV_RELAY_BASE` (default `http://v2-iptv-relay.railway.internal:8080`).
- `server/gateway-service.js`:
  - `switchCatalogChannel()` calls `cleanDynamicMistStreams()`, which **nukes and
    deletes every `iptv-*` Mist stream** before adding the new one. **This is the
    single biggest trap.** Copy this pattern onto a second slot and switching
    slot B kills slot A's live match.
  - `waitForFreeSlot()` polls the one relay's `/account` until `activeConnections === 0`.
  - `activeDynamicState()` returns `active` only when **exactly one** `iptv-*`
    input is live. Two live inputs give `active: null, conflict: true`.
  - `stopDynamic()` (operator "Off") stops **every** `iptv-*` stream.
- `src/remote.html` is the operator remote: one "active" card, `POST
  /operator/switch/<streamId>`, `POST /operator/off`, PIN in `x-operator-pin`.

### Cloudflare Worker (MorshLive)

- `backend/services/stream-plan.js` (**LOCKED**):
  `loadActiveV2State()` fetches `https://v2-control-production.up.railway.app/api/active`
  and reduces it to a **single** `activeChannelId`. A `conflict: true` body sets it to `null`.
  `gateV2Plan()` lets a match's V2 source play only if its `iptv-<id>` equals that one id.
  Otherwise the plan returns `status: "waiting"` with reason `v2-remote-other:<id>`,
  `v2-remote-off`, `v2-remote-unavailable`, `v2-before-match-window` (earlier than T-30) or
  `v2-match-expired`.
- `scripts/refresh-v2-bein-bindings.js` + `scripts/v2-bein-bindings-lib.js` turn
  FilGoal broadcaster rows into `assets/data/v2-qualifier-bindings.json`
  (match → `streamId`, `kickoffUtc`, `expiresAt`), generated plans in
  `assets/data/stream-plans.json`, and `channelId` on `today.json` cards.
  `assets/data/v2-bein-vega.json` maps `bein-sports-N` → Vega `streamId` (e.g. beIN 1 = `3645`).
  It runs in `.github/workflows/update-broadcasts.yml` (cron `43 */6 * * *`) and in
  the CI deploy step list (`lib/refresh-for-deploy.js`).
- `assets/js/watch.js` (**LOCKED**) recognises V2 by
  `V2_MIST_HLS_RE = /^https:\/\/v2-mist-production\.up\.railway\.app\/hls\/iptv-\d+\/index\.m3u8…/`.

**Consequence:** the URL shape `…/hls/iptv-<digits>/index.m3u8` is a contract
between three locked/tested places. **Keep it unchanged.** The account a stream is
pulled through is a server-side detail and must never appear in the public URL.

---

## 3. Target design (one paragraph)

Run a **second relay service** (`v2-iptv-relay-b`) from the same code with account B's
credentials. Teach `v2-control` about **N accounts = N slots** (N = 2), so it switches,
stops and reports **per slot** and never touches the other slot. Extend `/api/active`
**additively** (`live[]` already exists; add `capacity` and `slots[]`). Change the
MorshLive gate to accept **any live channel up to `capacity`** instead of exactly one.
Add a pure allocator in MorshLive that turns V2 bindings into a **slot schedule**
(`assets/data/v2-slot-schedule.json`), resolving collisions by priority. Then add an
**opt-in auto mode** in `v2-control` that follows that schedule unless the operator
has overridden a slot.

---

## 4. Phase 0 — prerequisites (owner inputs; stop and ask if missing)

1. **Account B credentials go only into Railway** as variables on the new
   `v2-iptv-relay-b` service: `V2_IPTV_PORTAL_URL`, `V2_IPTV_USERNAME`,
   `V2_IPTV_PASSWORD`, plus copy the non-secret relay vars from `v2-iptv-relay`
   (`V2_IPTV_CATALOG_MODE`, `V2_IPTV_MAX_ACTIVE_PULLS`, `V2_IPTV_ALLOWED_STREAM_IDS`,
   `V2_IPTV_AUDIO_DELAY_MS_BY_STREAM` if set). Never in git, never in chat logs,
   never in a MorshLive file.
2. **Decided (owner, Oct 17 2026): account B is on the same provider as A.** Stream IDs
   are therefore shared: `iptv-3645` (beIN 1) can be pulled through either account with
   the same `<id>.ts`, and any slot can carry any channel. **Do not build an ID-mapping
   layer** (no `V2_ACCOUNT_STREAM_MAP_JSON`, no per-account channel filter).
   Still run one cheap sanity check before going live, because it is metadata only
   (`player_api.php`) and safe while someone is watching: `GET /catalog` on relay A and relay B,
   and confirm every `streamId` in `assets/data/v2-bein-vega.json` has the same channel name on B.
   If any differ, stop and tell the owner instead of adding a mapping.
   Same provider also means the **same portal URL**, so the two accounts differ only by
   username. The fingerprint guard in 5.1 / 5.2 is what stops "two accounts" that are
   accidentally one.
3. **Name coverage (prerequisite, found on Oct 14 replay):** a match gets a V2 binding only
   if FilGoal's Arabic team names match the ESPN fixture via `TeamNames.arabicFor` in
   `assets/js/team-names.js`. On Oct 14, 2026, **4 of 9** Champions League matches got
   no binding because these ESPN names have no Arabic entry: `AS Roma` (روما),
   `Feyenoord Rotterdam` (فيينورد), `Como` (كومو), `Shakhtar Donetsk` (شاختار دونتسك),
   `VfB Stuttgart` (شتوتجارت). Roma–Real Madrid had no automatic V2 stream at all. Add those
   names, and make `scripts/refresh-v2-bein-bindings.js` log every FilGoal beIN row that matched
   no fixture (`V2 beIN bindings: unmatched row <homeAr> v <awayAr> <channel>`), so the next
   gap is visible. Do not loosen the fuzzy-match thresholds in `matchRowToFixture` instead.
4. Confirm account B's `max_connections` from relay B `/account`. Design for one
   connection per account. Do not try to multiplex two channels through one account.
   Per `AGENTS.md`, that limit is the owner's call: mention it once and build.

---

## 5. Phase 1 — KoraZero-StreamV2: two slots in `v2-control`

Work on a branch off `feature/gateway-control`. Tests run with `npm test` (`node --test`).

### 5.1 Relay B — infrastructure only, no code change

Create Railway service `v2-iptv-relay-b`: same repo, same start command as
`v2-iptv-relay` (`server/iptv-relay.js`), account B variables, private networking only.
Its internal base becomes `http://v2-iptv-relay-b.railway.internal:8080`.

One small relay change (needed for a guardrail):

- `server/iptv-relay-core.js` → `/account` response: add
  `accountFingerprint`, the first 12 hex characters of `sha256(portal + "|" + username)`.
  It is non-secret and lets the control refuse two "accounts" that are really one.
  Do **not** add username, password or portal to any response or log.

### 5.2 Files to change

| File | Change |
|------|--------|
| `server/runtime-config.js` | Parse new optional `V2_IPTV_ACCOUNTS_JSON` = `[{"id":"a","relayBase":"http://v2-iptv-relay.railway.internal:8080"},{"id":"b","relayBase":"http://v2-iptv-relay-b.railway.internal:8080"}]`. Validate: ids match `/^[a-z]$/`, unique; relayBase is `http(s)` and **must** end in `.railway.internal:<port>` or be localhost in tests; 1–2 entries. **When unset, build exactly one account `a` from `V2_IPTV_RELAY_BASE`, i.e. today's behaviour.** Create one `catalogClient` per account. |
| `server/iptv-catalog-client.js` | Expose `accountFingerprint` from `/account`. No behaviour change otherwise. |
| `server/gateway-service.js` | The main work, see 5.3. |
| `server/control-server.js` | `POST /operator/switch/<streamId>?slot=a\|b` (slot optional, auto-pick a free slot); `POST /operator/off?slot=a\|b` (when 2 accounts are configured, a missing slot is **400**, never "all"; with 1 account the legacy behaviour stays); `GET /operator/catalog?account=b` (PIN-gated). Map the new error `all_slots_busy` → **409**. Keep `/api/active` public and read-only. |
| `server/app.js` | At bootstrap, read each account's `/account`. If two fingerprints are equal, log loudly and **run single-slot** (account `a` only). Do not throw, because a crash takes V2 down entirely. |
| `src/remote.html` | Two slot cards (Slot A / Slot B). Each shows channel, viewers, inputs, mode (`manual` / `auto`), and has its own "Off" button. The channel button opens a slot chooser. If both slots are busy, ask which to replace. **Never replace silently.** |
| `docs/gateway-contract.md` | Document the new `/api/active` shape and the operator endpoints. |

### 5.3 `gateway-service.js` — exact behaviour

Replace the module-global single-slot state (`activeCatalogChannel`, `switchTail`,
`activeSwitchController`) with **per-slot** state: `slots = Map<accountId, {current, switchTail, controller, mode, manualUntil}>`.

- **Ownership:** a slot owns exactly the Mist stream it added. Record ownership in memory
  and make it recoverable from Mist: the Mist `source` of `iptv-<id>` is
  `<relayBase>/live/<id>.ts`, so the relay host identifies the account. Add
  `mist.getStreamSource(name)` (or read it from the config list) in
  `server/mist-api.js` so `active()` and a restarted control can rebuild
  `slot → stream` **from Mist, not memory**. The existing test "operator active
  state and off are derived from Mist, not controller memory" sets that standard.
- **Switch (`activate(streamId, {slot})`):**
  1. If `iptv-<streamId>` is already live on **any** slot, return `alreadyActive: true`
     and open **no** second pull. One channel never occupies two slots.
  2. Choose the slot: the requested one, else a free one, else throw `all_slots_busy`.
     **Never evict automatically.**
  3. Stop **only this slot's** current stream: nuke + delete + `observeMistInputExit`
     for that one name. `cleanDynamicMistStreams()` must not be called on a
     multi-slot switch. Keep it only for the legacy single-account path, or delete it
     and make the single-account path use the per-slot stop too.
  4. `waitForFreeSlot()` on **this account's** client only.
  5. `mist.addStream("iptv-<streamId>", "<thisRelay>/live/<streamId>.ts", {always_on:true})`
     (same id on both accounts, same provider).
  6. Verify HLS with `playbackProbeFn` exactly as today. On failure, clean up only this stream.
  7. Superseding: a newer selection on the **same slot** aborts the older one (today's
     `queueCatalogSwitch` semantics, per slot). Selections on different slots run
     concurrently and never abort each other.
- **`active()` response (additive; old fields keep their meaning for one slot):**
  ```json
  {
    "capacity": 2,
    "slots": [
      {"slot":"a","channelId":"iptv-3645","streamId":"3645","inputs":1,"viewers":40,"mode":"auto"},
      {"slot":"b","channelId":null}
    ],
    "live":   [ {"channelId":"iptv-3645", "...": "unchanged item shape"} ],
    "active": {"channelId":"iptv-3645", "...": "first live item, kept for old readers"},
    "conflict": false
  }
  ```
  `conflict` is `true` **only** when an invariant breaks: more live `iptv-*` inputs than
  `capacity`, two live inputs on one account, or a live `iptv-*` stream whose source
  belongs to no configured account. **Two healthy slots is not a conflict.**
- **`stopDynamic({slot})`:** stops that slot only. Stopping everything requires an
  explicit `slot: "all"`.

### 5.4 Auto mode (opt-in, ship after the manual two-slot path is proven)

New file `server/slot-scheduler.js`, started from `server/index.js` **only when
`V2_AUTO_SCHEDULE === 'true'`** (default off):

- Every 60s, `GET https://korazero.com/assets/data/v2-slot-schedule.json`
  (env `V2_SLOT_SCHEDULE_URL`). On fetch/parse failure **do nothing**: keep the current
  slots, never turn anything off because the schedule is unreachable.
- For each slot whose mode is `auto`: at an entry's `startAt`, `activate(streamId, {slot})`;
  after `endAt`, if that entry still owns the slot and no later entry follows on it, stop it.
- **Handover on a busy slot** (the previous match is still on it when the next entry's
  `startAt` arrives): wait until the previous match is finished (its `status` in
  `https://korazero.com/assets/data/today.json` is no longer `live`), **or** until the next
  entry's kickoff, whichever comes first. Then switch. A slow-finishing early match keeps its
  last minutes, and the next match never misses kickoff.
- **Manual wins:** any `/operator/switch` or `/operator/off` on a slot sets
  `mode: "manual"` and `manualUntil` = the end of the scheduled window covering now, or
  now + 3h if there is none. A "Resume auto" button on the remote clears it.
- **Never preempt a live entry** because the schedule changed: if the slot is serving a
  match whose window has started, keep it until its `endAt`, even if a newer schedule
  dropped it.
- Ignore entries whose `channelId` does not match `^iptv-\d+$` or whose `slot` is not
  configured.

---

## 6. Phase 2 — MorshLive gate (one locked file)

`backend/services/stream-plan.js` is in the Stream Lock table. Follow
`docs/STREAM-LOCK.md` exactly:

1. Create `config/stream-change-plan.json` from the example: baseline =
   `BASELINE_COMMIT` currently in `scripts/verify-stream-lock.mjs`, a 20+ character reason,
   `expiresAt` within 24h, `allowedFiles: ["backend/services/stream-plan.js"]`.
2. Make the change below. Test it, deploy it deliberately with
   `KZ_STREAM_CHANGE_APPROVED=YES_I_INTEND_TO_CHANGE_PRODUCTION_STREAMING`.
3. Re-baseline **only** the `backend/services/stream-plan.js` fingerprint in
   `scripts/verify-stream-lock.mjs`, with a comment stamp
   `CLAUDE-STAMP <date> — V2-MULTI-SLOT-GATE-1`, the same shape as the existing entries.
   Delete `config/stream-change-plan.json`. Nothing else in the table moves.

### The change

- `loadActiveV2State(env)` returns `{ activeChannelIds: string[], conflict }`:
  - On `body.conflict`, return `{ activeChannelIds: [], conflict: true }` (as today).
  - `capacity = Number.isInteger(body.capacity) && body.capacity >= 1 && body.capacity <= 4 ? body.capacity : 1`.
  - Collect ids from `body.live[].channelId`. If `live` is absent, use `[body.active?.channelId]`.
    Lowercase them and keep only `/^iptv-\d+$/`. De-duplicate.
  - **If the count exceeds `capacity`, treat it as a conflict** (fail closed). An old
    control that sends no `capacity` therefore keeps today's exactly-one rule.
  - Network/HTTP failure → `null` (as today, giving `v2-remote-unavailable`).
- `gateV2Plan(plan, state, timing)`: replace `v2ChannelId(source) === activeChannelId`
  with `state.activeChannelIds.includes(v2ChannelId(source))`. Keep every existing
  reason string. For `v2-remote-other:`, join the ids with `,`. Set
  `v2Remote: { active: <matched id or first id or null>, activeIds: [...] }`.
- Do not change the window/expiry logic, `V2_MIST_SOURCE_RE`, the endpoint, the
  1500 ms timeout, or anything in `getStreamPlan` outside the V2 branch.

**Deploy order matters:** this gate change must be **live on korazero.com before**
`v2-control` ever runs two inputs. The current gate reads two live inputs as
`conflict` and holds **every** V2 match. The new gate is backward compatible with the
current single-slot control, so it can ship first with zero behaviour change.

---

## 7. Phase 3 — automatic assignment + "which match wins"

### 7.1 Where the logic lives

| New file (MorshLive, unlocked) | Purpose |
|--------------------------------|---------|
| `lib/v2-slot-allocator.js` | Pure ESM: `scoreMatch(binding, priority)`, `allocateSlots({bindings, slots, priority, pins, previous, now})`. No I/O, no `Date.now()` (take `now`). |
| `assets/data/v2-match-priority.json` | Owner-editable weights, team tiers, rivalries (7.3). Data, not code, so the owner can retune without a code change. |
| `assets/data/v2-slot-pins.json` | Owner overrides: `{ "<matchId>": "must" \| "never" }`. Starts as `{}`. |
| `assets/data/v2-slot-schedule.json` | Generated output (7.4). Do not hand-edit. |
| `tests/v2-slot-allocator.test.js`, `tests/v2-match-priority.test.js` | Section 9. |

Wire-up: at the end of `main()` in `scripts/refresh-v2-bein-bindings.js`, after the
final `bindings` are computed, call the allocator and `writeIfChanged(SCHEDULE_PATH, …)`.
`scripts/` is CommonJS, so load the ESM lib with `await import("../lib/v2-slot-allocator.js")`
inside `main()`. This keeps `lib/refresh-for-deploy.js` and
`tests/refresh-for-deploy.test.js` **unchanged**: no new step in the deploy list.
Log one line: `V2 slots: N scheduled, M unassigned`.

`previous` = the existing `v2-slot-schedule.json`, used for the "never drop a started
entry" rule.

### 7.2 Allocation rule (deterministic, explainable)

Each binding becomes an **occupancy window** `[startAt, endAt)` (half-open, so back-to-back
windows that touch do not overlap), with `ko = broadcastKickoffUtc || kickoffUtc`:

- `startAt = ko − 15 min`
- `endAt = ko + 120 min` (a normal match plus half-time and stoppage time)

**Do not use the binding's `expiresAt` (ko + 165 min) or the gate's T-30 here.** Those are
expiry / visibility windows, not slot occupancy. Replaying Oct 14, 2026 with
`[ko − 30, expiresAt]` left LASK–Liverpool (16:45) holding slot b until 19:30. That made
Roma–Real Madrid (19:00) unassignable while slot b then sat idle from 19:30. With
`[ko − 15, ko + 120)` both fit. See the regression test in section 9. The runtime
scheduler (5.4) handles a match that overruns.

1. **Frozen entries first:** every entry in `previous` whose `startAt <= now < endAt`
   is kept on its slot, unchanged, if its match still has a binding with the same
   `streamId`. Automation never cuts a match that is already on air.
2. **Pins:** a `"never"` match is dropped. `"must"` matches go next, before scored ones.
3. **Order the rest** by `score` desc, then earlier `startAt`, then `matchId` ascending,
   so equal inputs always produce equal output.
4. **Greedy placement:** a match is placed on the first slot (`a` before `b`) whose
   existing entries do not overlap its window. Both accounts are on the same provider, so
   either slot can carry any channel. If no slot is free for the
   **whole** window, the match is **unassigned**. A match is aired in full or not at all.
   Never schedule a match you would have to cut halfway.
5. **Same channel, back to back:** prefer the slot that already carries that `streamId`
   in the adjacent window, so Mist keeps the same input.
6. A `streamId` never appears on two slots at overlapping times. Assert it, because
   `normalizeChannelWindows` already guarantees it upstream.

### 7.3 "Popular" / "better rivalry": the scoring

There is no audience-demand signal in the system today (favourites are browser-only,
and there is no per-match viewer history). So v1 is a **transparent editorial score**
the owner can tune in `v2-match-priority.json`:

```
score = competition[comp]
      + tier(home) + tier(away)
      + (rivalry(home, away) ? rivalryBonus : 0)
      + (both teams tier1 ? bigGameBonus : 0)
```

Starter file (team names must be the **ESPN display names** used in `today.json`;
the test checks each one resolves through `TeamNames.arabicFor`):

```json
{
  "version": 1,
  "competition": { "ucl": 50, "epl": 40, "laliga": 40, "afconq": 30, "unl": 25, "ligue1": 20 },
  "tier1": 30,
  "tier2": 15,
  "rivalryBonus": 40,
  "bigGameBonus": 20,
  "teams": {
    "tier1": ["Real Madrid", "Barcelona", "Liverpool", "Manchester City", "Manchester United",
              "Arsenal", "Chelsea", "Paris Saint-Germain", "Bayern Munich",
              "Egypt", "Morocco", "Algeria", "Tunisia", "Saudi Arabia"],
    "tier2": ["Atlético Madrid", "Tottenham Hotspur", "Newcastle United", "Aston Villa",
              "Juventus", "Inter Milan", "AC Milan", "Borussia Dortmund", "Marseille",
              "Portugal", "Spain", "France", "England", "Germany", "Italy"]
  },
  "rivalries": [
    ["Real Madrid", "Barcelona"], ["Real Madrid", "Atlético Madrid"], ["Barcelona", "Atlético Madrid"],
    ["Manchester United", "Manchester City"], ["Manchester United", "Liverpool"],
    ["Liverpool", "Everton"], ["Arsenal", "Tottenham Hotspur"], ["Arsenal", "Chelsea"],
    ["Chelsea", "Tottenham Hotspur"], ["Liverpool", "Manchester City"],
    ["Paris Saint-Germain", "Marseille"], ["Sevilla", "Real Betis"],
    ["Morocco", "Algeria"], ["Egypt", "Algeria"], ["Egypt", "Tunisia"]
  ]
}
```

Why this shape: the audience is Arabic-first, so Arab national teams and the clubs with
the largest Arab followings (Salah's Liverpool, Marmoush's City, Real/Barça) rank top.
Rivalries are an explicit list, not guessed from names. Example: El Clásico (40 + 30 + 30 + 40 + 20 = **160**)
beats Arsenal–Brentford (40 + 30 = **70**), which beats Lens–Nantes (20).

Every placed and unplaced match carries `reasons`, e.g.
`["competition:laliga+40","tier1:Real Madrid+30","rivalry+40"]`, so the owner can see
why a match lost.

**Phase 2 signal (optional, only if asked):** blend in real demand later, e.g. watch-page
request counts per `match=` from Cloudflare analytics over the previous 7 days for
each team. Add it as another weight in the same file. Do not build it in v1.

### 7.4 Output shape `assets/data/v2-slot-schedule.json`

```json
{
  "version": 1,
  "generatedAt": "2026-10-18T09:00:00.000Z",
  "capacity": 2,
  "slots": ["a", "b"],
  "entries": [
    {"slot":"a","matchId":"espn-esp.1-…","streamId":"3645","channelId":"iptv-3645",
     "startAt":"…","endAt":"…","score":160,"reasons":["…"],"pinned":false}
  ],
  "unassigned": [
    {"matchId":"espn-fra.1-…","streamId":"3650","score":20,"reason":"outranked","by":["espn-esp.1-…","espn-eng.1-…"]}
  ]
}
```

No credentials, no account ids beyond the slot letters, no provider URLs.
`capacity` here is read from a constant in the allocator call (`["a","b"]`).
Changing slot count is a deliberate code + test change.

The watch page needs no change for unassigned matches: the gate already returns
`waiting` / `v2-remote-other:` for them.

---

## 8. Files — touch / do not touch

### MorshLive

| Touch | Why |
|-------|-----|
| `backend/services/stream-plan.js` | **Locked.** Multi-slot gate, via stream-change plan (section 6) |
| `scripts/verify-stream-lock.mjs` | Re-baseline that one file's hash, with a stamp |
| `config/stream-change-plan.json` | Temporary, then delete |
| `lib/v2-slot-allocator.js` (new) | Allocator |
| `assets/data/v2-match-priority.json`, `assets/data/v2-slot-pins.json` (new) | Config |
| `assets/data/v2-slot-schedule.json` (new, generated) | Output |
| `scripts/refresh-v2-bein-bindings.js` | Call the allocator, write the schedule |
| `tests/stream-plan-route.test.js` | New gate cases |
| `tests/v2-single-socket.test.js` | Update string assertions deliberately (section 9) |
| `tests/v2-slot-allocator.test.js`, `tests/v2-match-priority.test.js` (new) | New |
| `docs/STREAM-PLANS.md`, this file | Document the result |

| **Do not touch** | Why |
|------------------|-----|
| `assets/js/watch.js`, `watch.html`, `watch-embed.*`, `watch-loader.js`, `watch-lab-continuity-guard.js`, `mpegts-*`, `iptv-quality.js`, `iptv-lab.*` | Locked player. The V2 URL shape is unchanged, so the player needs nothing |
| `backend/adapters/xtream*.js`, `backend/services/xtream.js`, `backend/services/iptv-lab.js`, `backend/routes/*`, `backend/router.js`, `lib/iptv-lab.js`, `lib/xtream-*.js` | The old Xtream/Lab line, which is a different system |
| `worker.js`, `wrangler.toml` | Locked. No new secret is needed: `V2_CONTROL_ACTIVE_URL` already exists as an optional override |
| `scripts/v2-bein-bindings-lib.js` (`buildBindings`, `normalizeChannelWindows`, `mergeGeneratedPlans`) | Binding correctness is already tested. Consume its output, do not reshape it |
| `assets/data/v2-bein-vega.json` | Channel → streamId truth for both accounts (same provider) |
| `lib/refresh-for-deploy.js`, `.github/workflows/*` | Not needed. Workflow changes need the owner's approval |
| `assets/data/stream-plans.json` by hand | Generated; the gate already handles losers |

### KoraZero-StreamV2

| Touch | Do not touch |
|-------|--------------|
| `server/runtime-config.js`, `server/gateway-service.js`, `server/control-server.js`, `server/app.js`, `server/iptv-catalog-client.js`, `server/mist-api.js` (read source), `server/iptv-relay-core.js` (fingerprint only), `server/slot-scheduler.js` (new), `server/index.js` (start scheduler behind flag), `src/remote.html`, `docs/gateway-contract.md`, matching `tests/*.test.js` | `server/provider-hls-source.js`, the TS framing / null-burst / audio-delay code in `iptv-relay-core.js`, `server/source-supervisor.js` (and the `if (false) app.sourceSupervisor.start()` line), `V2_EMERGENCY_3645_ONLY` handling, `server/playback-probe.js`, `src/player/*`, `src/watch.html`, `scripts/audit-donor-boundary.mjs` (must still pass) |

---

## 9. Tests (write the failing test first)

### MorshLive: `npm run lint && npm test` must pass

`tests/stream-plan-route.test.js`: add cases next to
"promotes only the pending V2 source whose Mist channel is active", reusing its `assetEnv` + `fetch` stub pattern:

1. **Two live slots → both matches play.** Body
   `{capacity:2, live:[{channelId:"iptv-3645"},{channelId:"iptv-3644"}], conflict:false}`;
   two plans on 3645 and 3644. Each request returns `status:"operator"`,
   `reason:"remote-active:iptv-36xx"` for its own channel.
2. **Third match waits.** A plan on `iptv-3650` with the same body gives `status:"waiting"`,
   `selected:null`, and a reason starting `v2-remote-other:`.
3. **Legacy body still works.** `{active:{channelId:"iptv-89778"},conflict:false,live:[]}`
   with no `capacity` keeps today's result. The existing test must stay green unmodified.
4. **Over capacity fails closed.** Two live ids with no `capacity` (old control) → every V2
   plan waits. Three live ids with `capacity:2` → every V2 plan waits.
5. **`conflict:true` holds every V2 plan** even when `live` lists ids.
6. **Junk ids are ignored:** `iptv-abc`, `IPTV-12/../x`, `null`, numbers.
7. **Window/expiry unchanged:** an active slot before T-30 still gives `v2-before-match-window`.

`tests/v2-single-socket.test.js`: the second test asserts literal strings
(`const activeChannelId = state?.activeChannelId || null`) that this change
replaces. Rename it to "uses controller state as the runtime authority for V2 slots"
and assert the new equivalents (`activeChannelIds`, the capacity clamp, `selected: null`,
`v2-remote-other:`, `v2-remote-off`, the endpoint URL). **Keep the first test
("every static V2 match mapping fail-closed and single-source") exactly as is.**
Do not delete assertions to get green. Each removed string needs a replacement that
pins the same property.

`tests/v2-slot-allocator.test.js` (pure, fixed `now`):

1. Three overlapping matches, 2 slots: the two highest scores are placed and the third is
   `unassigned` with `by` naming both winners.
2. El Clásico vs two low matches at the same kickoff: Clásico is on slot `a`.
3. Ties break on earlier `startAt`, then `matchId`. Running twice gives byte-identical output.
4. **No mid-match cut:** `previous` has a started low-score entry on `a`; a new high-score
   overlapping match arrives. The started entry stays, and the new one goes to `b` or is unassigned.
5. A match that only partially fits a slot is unassigned, never split.
6. `"must"` pin beats a higher score. `"never"` pin is never placed.
7. Back-to-back on the same `streamId` stays on the same slot.
8. No `streamId` on two slots at overlapping times (property check over random fixtures).
9. Empty bindings → empty schedule. Expired bindings are ignored.
10. **Oct 14, 2026 regression** (store the 9 inputs in `tests/fixtures/v2-allocator-2026-10-14.json`:
    matchId, home, away, competition `ucl`, kickoffUtc, streamId):
    16:45 LASK–Liverpool (beIN 2), Feyenoord–Como (beIN 4); 19:00 Man City–PSG (beIN 1),
    Roma–Real Madrid (beIN 3), Bodø/Glimt–Dortmund (beIN 6), Aston Villa–Fenerbahçe (beIN 4),
    Real Betis–Porto (beIN 5), Shakhtar–AEK (beIN Xtra 1), Slovan–Stuttgart (beIN 8).
    Expected with the starter priority file: **16:45 both matches placed; 19:00 Man City–PSG
    (130) and Roma–Real Madrid (80) placed**; Dortmund (65), Villa (65), Betis–Porto,
    Shakhtar–AEK and Slovan–Stuttgart (50) unassigned with `by` naming the two winners.
    Assert by set per kickoff, not by slot letter.

`tests/v2-match-priority.test.js`: the JSON parses; every team in `tier1`, `tier2` and
`rivalries` resolves via `TeamNames.arabicFor` (note: ESPN says **"Inter Milan"**, not
"Internazionale"); no team in both tiers; competition keys ⊆ `BEIN_COMPETITIONS` from
`scripts/v2-bein-bindings-lib.js`; weights are non-negative integers; rivalries are pairs
of distinct teams with no duplicate pair in either order.

Existing suites that must stay green untouched: `stream-lock.test.js` (after the
re-baseline), `v2-path-isolation.test.js`, `v2-bein-bindings.test.js`,
`psg-v2-matchday-stability.test.js`, `refresh-for-deploy.test.js`.

### KoraZero-StreamV2: `npm test` (`node --test`), plus `npm run audit:donor`

`tests/runtime-config.test.js`: unset `V2_IPTV_ACCOUNTS_JSON` gives exactly one account
from `V2_IPTV_RELAY_BASE`; a valid two-account JSON is accepted; duplicate ids,
non-internal hosts, more than 2 accounts or bad JSON throw.

`tests/gateway-service.test.js`: these are the regression tests that matter:

1. **Switching slot b never nukes or deletes slot a's stream.** Assert on the fake Mist call log.
2. Activating a stream already live on `a` returns `alreadyActive` and makes no `addStream`
   and no `waitForFreeSlot` on `b`.
3. Both slots busy with no slot given → `all_slots_busy`, nothing stopped.
4. `stopDynamic({slot:"b"})` leaves `a` running. A missing slot with 2 accounts is rejected.
5. `active()` with two healthy slots → `capacity:2`, `conflict:false`, two `live`, `slots`
   mapped by relay host from the Mist source.
6. Two inputs whose sources are the same relay → `conflict:true`.
7. Restart: a fresh service with Mist already holding `iptv-3645@relay-a` and
   `iptv-3644@relay-b` reports both slots correctly (derived from Mist, not memory).
8. Superseding on slot `a` aborts only `a`'s pending switch. A concurrent `b` switch completes.
9. A switch on slot `b` adds `iptv-<id>` with source `<relay-b>/live/<id>.ts`, the same id as on `a`.
10. All existing single-slot tests pass unchanged with `V2_IPTV_ACCOUNTS_JSON` unset.

`tests/control-server.test.js`: `?slot=` routing, 401 without PIN, 409 mapping for
`all_slots_busy`, `/api/active` shape. No response or log line contains a portal URL,
username or password. Grep the serialized responses in the test.

`tests/iptv-relay.test.js`: `/account` includes `accountFingerprint`, which is stable for
the same env and differs across accounts; no credential substrings appear in the body.

New `tests/slot-scheduler.test.js` (fake clock + fake fetch): starts the entry at
`startAt`; stops at `endAt`; schedule fetch failure changes nothing; a manual switch puts the
slot in `manual` until `manualUntil` and auto skips it; a started entry dropped from a
newer schedule is **not** stopped early; the flag off means the scheduler never starts.

---

## 10. Guardrails (non-negotiable)

- **Credentials:** account B lives only in Railway variables on `v2-iptv-relay-b`.
  Nothing secret in either repo, in `/api/*` responses, in logs, or in the schedule file.
- **Public URL shape is frozen:** `…/hls/iptv-<digits>/index.m3u8`, with no slot or account
  in it. `V2_MIST_HLS_RE` / `V2_MIST_SOURCE_RE` and the test prefixes stay as they are.
- **One locked file only** in MorshLive (`backend/services/stream-plan.js`), changed through
  the documented plan + approval flow and re-baselined alone. No tree-wide rollback.
- **Automation never evicts a live match.** Only a human on the remote can, and the
  remote asks before replacing.
- **Fail closed everywhere:** schedule unreachable → keep current slots. `/api/active`
  unreachable → `waiting`. More live inputs than capacity → `conflict` → hold.
- **No probing account A's media while it is serving viewers.** Verifying account B is
  fine while B is idle. Metadata calls (`/catalog`, `/account`) are fine anytime.
  Keep `.github/workflows/premium-iptv-smoke.yml` as it is.
- **Kill switches:** unset `V2_IPTV_ACCOUNTS_JSON` → single slot; `V2_AUTO_SCHEDULE`
  not `true` → no automation. Both default to today's behaviour.
- **Don't widen the channel set** as part of this work (`v2-bein-vega.json`,
  `CHANNEL_DEFS`). See `docs/HANDOVER-STREAM-DRAIN.md` for why.
- **Do not weaken tests** to get green. Replaced assertions must pin the same property.

---

## 11. Rollout, verification, rollback

Order (each step is independently safe):

1. **MorshLive gate** (section 6). Merge, deploy with the approval flag, curl
   `https://korazero.com/api/stream-plan?match=<a V2 match>` and confirm the same result
   as before (the control still reports one input).
2. **StreamV2 control multi-slot code**, deployed with `V2_IPTV_ACCOUNTS_JSON` **unset**.
   Run the single-slot regression on the remote: one switch, one off.
3. **Create `v2-iptv-relay-b`**, set account B. Check `/account` through the control
   logs: fingerprints differ, `maxConnections` known, and run the catalogue sanity check
   from section 4.2.
4. **Set `V2_IPTV_ACCOUNTS_JSON`** on `v2-control`, redeploy. On the remote, put a channel
   on slot B while slot A is idle. Confirm `GET /api/active` shows
   `capacity:2`, `conflict:false`. Then put a different channel on A and confirm both match
   pages play. Do this **outside a live match window** for account A.
   Same-provider check: while both slots run, confirm neither relay logs an auth failure
   and account A's `/account` still shows its own session. If the provider rejects two
   accounts from one Railway egress IP, stop and tell the owner (per-service static
   outbound IPs on Railway are the likely remedy). Don't work around it in code.
5. **MorshLive allocator** PR: merged, schedule file live at
   `https://korazero.com/assets/data/v2-slot-schedule.json`. Have the owner read the
   `reasons` for the coming weekend.
6. **`V2_AUTO_SCHEDULE=true`** on `v2-control`, first on a day with a known collision,
   with the owner watching the remote.

Rollback: step 6 → unset `V2_AUTO_SCHEDULE`. Steps 3–4 → unset `V2_IPTV_ACCOUNTS_JSON`;
the remote returns to one slot, and stopping the B stream is a manual "Off". The MorshLive
gate needs no rollback because it is backward compatible with a single-slot control.

---

## 12. Open questions for the owner (ask once, then build with the defaults)

1. ~~Is account B the same provider as A?~~ **Answered Oct 17: yes, same provider.**
   Shared stream IDs, no mapping layer (section 4.2).
2. Are the starter team tiers and rivalries right for your audience? Default: ship the
   list in 7.3, since it is a data file and easy to change.
3. Auto mode on from day one, or remote-only for the first weekend? Default:
   remote-only for one match day, then enable.
