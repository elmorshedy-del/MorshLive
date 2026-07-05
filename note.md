# Match stream bugs & fixes log

Operator notes for KoraZero live channel issues. One section per match incident.

---

## Brazil vs Norway — 2026-07-05 (Round of 16)

**Kickoff:** 2026-07-05T20:00Z · **Channel:** beIN MAX 1 (`bein-max-1`) · **Commentator:** علي الكعبي

### Bug
- Brazil game started; user reported **none of the channels work**.
- Watch page showed a single player with **no channel picker** and no server buttons.
- worldkoora upstream returned **no HLS** (blank embeds); last-known CDN `1.554564.sbs` returned **451**.
- dlhd MAX AR (597) returned **500**; only **premium91/92/94** intermittently live.
- Twitch fallback (`majed20267` on vip1) often offline or wrong content.

### Fix (2026-07-05)
1. **UI:** Added all 6 beIN channels + 8 server buttons (VIP1/VIP2 × serv 1–4) on `watch.html`, with green live highlighting via `stream-check.js`.
2. **Worker:** Expanded `DLHD_CHANNEL_MIRROR_IDS` fallbacks (91, 92, 94, 95) and `GLOBAL_DLHD_FALLBACK_IDS` so dead MAX mirrors still get live dlhd pools.
3. **Routing:** Pinned `embedKey: "vip1"` on Brazil match in `today.json`; calibration entry in `channel-bindings.json` v10.
4. **Verified live:** `GET /wk/albaplayer/vip1/?ch=bein-max-1&serv=3` → dual player with dlhd `premium91` HLS proxy working.

### Working mirrors at fix time
| Channel | dlhd pool | Notes |
|---------|-----------|-------|
| beIN MAX 1 | premium91 | Brazil match channel |
| beIN MAX 2 | premium92 | |
| beIN Sports 2 | premium92 | |
| beIN Sports 4 | premium94 | |

### Test URL
`https://korazero.com/watch.html?ch=bein-max-1&match=espn-fifa.world-760504&serv=3`

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

*Add new entries at the top when a match stream breaks.*
