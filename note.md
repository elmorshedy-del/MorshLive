# Match stream bugs & fixes log

Operator notes for KoraZero live channel issues. One section per match incident, plus a rolling changelog for cross-cutting platform fixes.

---

## Changelog — 2026-07-05 (Brazil night session)

Commits on `main` during Brazil vs Norway (Round of 16). PR #76 branch merged.

| Commit | Summary | Files |
|--------|---------|-------|
| `8bea833` | Brazil: 6-channel picker, 12 VIP server buttons, dlhd fallbacks, `note.md` | `watch.html`, `watch.js`, `worker.js`, `today.json`, `channel-bindings.json` |
| `dd456df` | Weshan alt player (serv 0–3), `?player=weshan`, lineups cache fix | `data.js`, `watch.js`, `i18n.js`, `styles.css` |
| `aad27fe` | Weshan spam/popup block — proxy via worker, iframe sandbox | `worker.js`, `data.js`, `watch.js` |
| `8b71830` | Stop 90s auto-refresh from reloading the video | `watch.js`, `stream-check.js` |
| `f40cbe5` | Expanded `note.md` changelog for Brazil session | `note.md` |
| *(pending)* | Brazil H1 apology notice — compact red glow banner | `match-notice.json`, `match-notice.js`, `watch.html`, `index.html` |

### Match notice banner (Brazil H1 apology)

**Config:** `assets/data/match-notice.json` — set `"enabled": false` or change `"id"` to show again after dismiss.

**Placement:** Watch page above player (below تحديث البث); home page under featured-live card.

**Behavior:** Dismiss persists in `localStorage` until config `id` changes. No auto-hide. Compact — full text wraps, no truncation.

**Stats beta notice (`statsBeta`):** Above stats on watch page + home live-detail. Gold glow, separate dismiss key. Set `statsBeta.enabled: false` to hide.

**Copy (stats):**
- AR: مركز الإحصائيات ميزة جديدة ما زالت قيد التطوير — قد ترون أرقاماً غير دقيقة أحياناً. نعمل على ضبطها مباراة بعد مباراة حتى تصل إلى الكمال.
- EN: Match stats are a new feature still in development — some figures may be off at times. We're refining them with every match until they're spot-on.

**To reuse later:** Set `enabled: true`, new `id`, and `matchIds` for stream apology; new `statsBeta.id` to reset stats dismiss.

### Match poll — Brazil vs Norway (`match-poll.json`)

**Placement:** Under stream on watch page. Title: **تتوقع من؟**

**Behavior:** One vote per browser (`localStorage` voter id + server dedup). After vote → percentage bars + total votes. Survives refresh; 90s match refresh only updates totals if already voted.

**Disable:** `match-poll.json` → `"enabled": false`

---

**Bug**
- User reported **none of the channels work** when Brazil kicked off.
- Watch page had a **single iframe** — no channel row, no server buttons, no lineup/stats panel.
- worldkoora upstream: **no HLS** in embeds; CDN `1.554564.sbs` → **451**.
- dlhd MAX AR (597) → **500**; only `premium91/92/94` intermittently live.
- Twitch fallback on vip1 often offline or wrong channel.

**Fix**
1. **UI (`watch.html` + `watch.js`):** 6 beIN channel buttons + 8 VIP servers (VIP1/VIP2 × serv 1–4). Green/red highlighting via `stream-check.js`. `match-detail-slot` for pitch lineups + live stats (`buildLineupsHtml`, `buildStatsHtml`).
2. **Worker (`worker.js`):** Expanded `DLHD_CHANNEL_MIRROR_IDS` and `GLOBAL_DLHD_FALLBACK_IDS` [92, 94, 95, 91] so dead MAX mirrors still probe live dlhd pools.
3. **Routing:** Pinned `embedKey: "vip1"` on Brazil in `today.json`; `channel-bindings.json` v10 calibration.
4. **Verified:** `/wk/albaplayer/vip1/?ch=bein-max-1&serv=3` → dual HLS + Twitch when mirrors live; Twitch-only when HLS pool empty.

**Test:** `https://korazero.com/watch.html?ch=bein-max-1&match=espn-fifa.world-760504&serv=3`

---

### `dd456df` — Weshan alternate player + lineups on cache path

**Bug**
- Only VIP1/VIP2 available; user wanted another embed source.
- Pitch lineups missing when live API failed and page fell back to cached `today.json` (`matchDetailIndex` not merged on cache path).

**Fix**
1. **`data.js`:** Registered `weshan` embed (`zenvixw.site/wordpress/albaplayer/weshan/`, serv 0–3). `embedUrlFor()` supports `external` flag (later removed when proxied).
2. **`watch.js`:** `STREAM_SOURCES` = VIP1 + VIP2 + Weshan (4 servers each). Purple `server-btn--alt` styling. URL param `?player=weshan&serv=0`.
3. **`data.js` `getMatches()`:** Apply `matchDetailIndex` via `loadMatchDetailIndex()` + `applyMatchDetail()` on cached `today.json` path so lineups/stats show offline.
4. **`i18n.js`:** `watch.weshan` label. Cache bust `?v=20260705h`.

**Test:** `https://korazero.com/watch.html?ch=bein-max-1&player=weshan&serv=0`

---

### `aad27fe` — Weshan «مباشر» spam / popup (KoraZero promise breach)

**Bug**
- Clicking **مباشر** on top of the Weshan iframe opened **spam/ad sites**.
- Inherited from upstream AlbaPlayer (`aplr-menu`, `AplrPopUp`, obfuscated ad scripts on `zenvixw.site`).
- Direct cross-origin iframe could not be stripped client-side; violates “بدون إعلانات ولا نوافذ منبثقة”.

**Fix**
1. **Worker:** New route `/wk/albaplayer/weshan/` — fetch upstream server-side, extract HLS (`do.nuvolda.store/…m3u8`), serve `cleanHlsPlayerHtml` (same as VIP clean player). No upstream menu/scripts.
2. **`data.js`:** Weshan URL changed to same-origin `/wk/albaplayer/weshan/` (removed `external: true`).
3. **VIP fallback hardening:** `HIDE_OVERLAY_STYLE` hides `.aplr-menu`; `stripBlockedScripts` blocks `jnbhi.com`, `AplrPopUp`, etc.
4. **`watch.js`:** Iframe `sandbox` without `allow-popups`.
5. **Verified:** Proxied page has `<video id="v">` only — no `aplr-menu`, no «مباشر». HLS chain master → variant → segment all **200**.

**Test:** `https://korazero.com/wk/albaplayer/weshan/?serv=0`

---

### `8b71830` — Auto-refresh reloads video mid-stream

**Bug**
- Video **auto-reloaded** every ~90s while watching (especially on Weshan).
- Cause: `refreshMatches()` every 90s called `renderServers()` → wiped buttons → `StreamCheck.autoHighlight` picked **first green server** (VIP1 · serv 1) even when user had Weshan or another server active → `reloadPlayer()`.

**Fix**
1. **`watch.js` `renderServers()`:** Only auto-switch when active server is **down** or missing; skip DOM rebuild if channel/embed/serv unchanged.
2. **`watch.js` `refreshMatches()`:** On 90s tick, update scores/stats/sidebar only — rebuild servers + reload iframe **only** when channel or match id changes.
3. **`stream-check.js`:** If `.server-btn.active` is already `srv-ok`, do not auto-click another server.
4. **120s health re-probe** unchanged — updates green/red dots without replacing iframe.
5. Cache bust `?v=20260705j`.

**Regression check:** VIP1, VIP2, Weshan, dlhd `/dl/91` all still **200** after deploy.

---

## Brazil vs Norway — 2026-07-05 (Round of 16)

**Kickoff:** 2026-07-05T20:00Z · **Channel:** beIN MAX 1 (`bein-max-1`) · **Commentator:** علي الكعبي · **Match id:** `espn-fifa.world-760504`

### Summary timeline
| Time (UTC) | Issue | Resolution |
|------------|-------|------------|
| ~20:00 | No channels work, no picker UI | PR #76 — channel + server UI, dlhd fallbacks |
| ~20:30 | User wanted Weshan embed | `dd456df` — Weshan servers 0–3 |
| ~20:48 | Weshan «مباشر» opens spam | `aad27fe` — worker proxy, clean player |
| ~20:53 | Video auto-reloads every 90s | `8b71830` — stop server hijack on refresh |

### Working mirrors at fix time
| Channel | dlhd pool | Notes |
|---------|-----------|-------|
| beIN MAX 1 | premium91 | Brazil match channel |
| beIN MAX 2 | premium92 | |
| beIN Sports 2 | premium92 | |
| beIN Sports 4 | premium94 | |
| Weshan | `do.nuvolda.store/guian3.m3u8` | Via `/wk/albaplayer/weshan/` proxy |

### Test URLs
- **VIP:** `https://korazero.com/watch.html?ch=bein-max-1&match=espn-fifa.world-760504&serv=3`
- **Weshan:** `https://korazero.com/watch.html?ch=bein-max-1&match=espn-fifa.world-760504&player=weshan&serv=0`
- **Lineups/stats:** Same URLs — scroll below player to `match-detail-slot`

---

## France vs Paraguay — 2026-07-04 (Round of 16)

**Channel:** beIN MAX 1 · **ملخص:** vortex `4Duh6QTRDC3M6`

### Bug
- Tournament nav missing on production; memes wiped by Twitter API credit depletion.

### Fix
- Pinned TrollFootball meme in `pinned-match-memes.json`; featured section on tournament page; API credit conservation (no bulk fetch by default).

---

## Portugal vs Croatia — 2026-07-03

### Bug
- beIN Sports 1 showed Twitch or blackout.

### Fix
- Route `bein-sports-1` → vip1 serv=3; worker heals dead serv manifests.

---

## Egypt vs Iran / NZ vs Belgium — 2026-06-27

### Bug
- vip1/vip2 inverted for simultaneous MAX 1/2 kickoff.

### Fix
- Swap `bein-max-1`→vip1, `bein-max-2`→vip2; pin `embedKey` on both matches.

---

## Kooracity stream pause (not a bottom watermark)

**What users see:** The whole stream **stops** for ~30 seconds with a full-screen message telling viewers to go to the original kooracity site («اذهب للموقع الأصلي»). It **loops** before the match resumes. This is **not** a small burned-in ticker — hiding it with CSS does nothing.

**Where it comes from:** Some dlhd/worldkoora HLS mirrors inject branding pause segments into the feed.

**Mitigation (worker `cleanHlsPlayerHtml` + `cleanDualPlayerHtml`):**
- After **7s** with no time advance → jump to live edge (skip stuck segment)
- After **14s** still stuck → switch to next verified mirror in the pool
- If playback time **jumps backward** (looping branding clip) → switch mirror immediately

**Not spam:** Same class as upstream kooracity branding, different from AlbaPlayer «مباشر» popup menus.

---

## Platform patterns (reuse on next incident)

| Pattern | Where | What to do |
|---------|-------|------------|
| Dead MAX mirror | `worker.js` `DLHD_CHANNEL_MIRROR_IDS` | Add fallback ids 91–95; bump `channel-bindings.json` |
| New AlbaPlayer host | `worker.js` | Proxy at `/wk/albaplayer/{slug}/`, extract HLS, serve `cleanHlsPlayerHtml` — never raw iframe |
| Spam «مباشر» menu | Upstream AlbaPlayer | Hide `.aplr-menu`; block `AplrPopUp`; sandbox without `allow-popups` |
| Video reloads alone | `watch.js` | Don't rebuild servers on stats refresh; only switch if active `srv-down` |
| Lineups missing | `data.js` `getMatches()` | Ensure `applyMatchDetail()` runs on cached `today.json` path |
| Pin live match routing | `today.json` + bindings | Set `embedKey`, `channelId`; calibrate in `channel-bindings.json` |

---

*Add new match entries at the top. Append platform fixes to the changelog section.*
