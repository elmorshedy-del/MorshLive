/* Auto-synced from assets/data/channel-bindings.json by fetch-matches.js */
window.KZ_CHANNEL_BINDINGS = {
  "version": 8,
  "updatedAt": "2026-06-27T03:15:00.000Z",
  "embedBinding": {
    "bein-max-1": "vip1",
    "bein-max-2": "vip2",
    "bein-max-3": "vip1",
    "bein-max-4": "vip2",
    "bein-sports-1": "vip2",
    "bein-sports-2": "vip1"
  },
  "calibration": [
    {
      "date": "2026-06-27T03:15:00.000Z",
      "issue": "Egypt vs Iran (MAX 1) showed wrong stream at 03:00 UTC; collides with NZ vs Belgium on MAX 2.",
      "rootCause": "vip1/vip2 inverted for MAX 1/2 pair during simultaneous 03:00 UTC kickoff.",
      "fix": "Swap bein-max-1→vip1 (Egypt) and bein-max-2→vip2 (Belgium); pin embedKey on both matches.",
      "liveAtTime": [
        {
          "match": "Egypt vs Iran",
          "channelId": "bein-max-1",
          "channel": "beIN MAX 1",
          "embedKey": "vip1"
        },
        {
          "match": "New Zealand vs Belgium",
          "channelId": "bein-max-2",
          "channel": "beIN MAX 2",
          "embedKey": "vip2"
        }
      ],
      "userReport": "Fix Egypt now"
    },
    {
      "date": "2026-06-27T00:00:00.000Z",
      "issue": "Cape Verde vs Saudi Arabia (MAX 3) showed Uruguay pre-game; both MAX 3 and Sports 1 routed to vip2.",
      "rootCause": "Static odd-MAX→vip2 rule put bein-max-3 and bein-sports-1 on the same vip slot during the 00:00 UTC window.",
      "fix": "Route bein-max-3 to vip1 (Saudi) and keep bein-sports-1 on vip2 (Uruguay); swap MAX 4 to vip2 so MAX 3/4 stay on different slots.",
      "liveAtTime": [
        {
          "match": "Cape Verde vs Saudi Arabia",
          "channelId": "bein-max-3",
          "channel": "beIN MAX 3",
          "embedKey": "vip1"
        },
        {
          "match": "Uruguay vs Spain",
          "channelId": "bein-sports-1",
          "channel": "beIN Sports 1",
          "embedKey": "vip2"
        }
      ],
      "userReport": "Saudi game not showing; both streams showed Uruguay pre"
    },
    {
      "date": "2026-06-26T21:00:00.000Z",
      "issue": "France vs Norway (beIN MAX 2) played beIN MAX 1 stream.",
      "rootCause": "vip.worldkoora vip1/vip2 are generic wrappers — slot name does not match beIN MAX number (vip1 carries MAX 2, vip2 carries MAX 1).",
      "fix": "Swap MAX 1/2 (and 3/4, Sports 1/2) embedBinding: odd MAX → vip2, even MAX → vip1.",
      "liveAtTime": [
        {
          "match": "Norway vs France",
          "channelId": "bein-max-2",
          "channel": "beIN MAX 2",
          "embedKey": "vip1"
        },
        {
          "match": "Senegal vs Iraq",
          "channelId": "bein-max-1",
          "channel": "beIN MAX 1",
          "embedKey": "vip2"
        }
      ]
    },
    {
      "date": "2026-06-26T00:00:00.000Z",
      "issue": "Both simultaneous live matches showed the opposite stream (Ecuador/Germany ↔ Curaçao/Ivory Coast).",
      "rootCause": "Assumed vipN maps to beinmaxN; worldkoora slots are inverted.",
      "fix": "Reverted mistaken bein-max-1→vip1 map; see 2026-06-26T21:00 calibration.",
      "liveAtTime": []
    },
    {
      "date": "2026-06-25T23:42:00.000Z",
      "issue": "Both live cards played Tunisia vs Netherlands (Japan vs Sweden also showed Tunisia).",
      "rootCause": "bein-max-3→vip2 and bein-max-4→vip1 inverted the MAX 3/4 pair (same class of bug as MAX 1/2).",
      "fix": "Odd MAX channels → vip2, even MAX → vip1 (matches inverted vip slots).",
      "liveAtTime": [
        {
          "match": "Japan vs Sweden",
          "channelId": "bein-max-4",
          "channel": "beIN MAX 4",
          "embedKey": "vip1"
        },
        {
          "match": "Tunisia vs Netherlands",
          "channelId": "bein-max-3",
          "channel": "beIN MAX 3",
          "embedKey": "vip2"
        }
      ],
      "userReport": "Both live matches played Tunisia vs Netherlands"
    }
  ]
};
