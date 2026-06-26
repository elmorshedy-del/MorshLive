/* Auto-synced from assets/data/channel-bindings.json by fetch-matches.js */
window.KZ_CHANNEL_BINDINGS = {
  "version": 5,
  "updatedAt": "2026-06-26T21:00:00.000Z",
  "embedBinding": {
    "bein-max-1": "vip2",
    "bein-max-2": "vip1",
    "bein-max-3": "vip2",
    "bein-max-4": "vip1",
    "bein-sports-1": "vip2",
    "bein-sports-2": "vip1"
  },
  "calibration": [
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
