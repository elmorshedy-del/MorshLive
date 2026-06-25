/* Auto-synced from assets/data/channel-bindings.json by fetch-matches.js */
window.KZ_CHANNEL_BINDINGS = {
  "version": 4,
  "updatedAt": "2026-06-25T23:45:00.000Z",
  "embedBinding": {
    "bein-max-1": "vip1",
    "bein-max-2": "vip2",
    "bein-max-3": "vip1",
    "bein-max-4": "vip2",
    "bein-sports-1": "vip1",
    "bein-sports-2": "vip2"
  },
  "calibration": [
    {
      "date": "2026-06-26T00:00:00.000Z",
      "issue": "Both simultaneous live matches showed the opposite stream (Ecuador/Germany ↔ Curaçao/Ivory Coast).",
      "rootCause": "EMBED_BINDING had bein-max-1→vip2 and bein-max-2→vip1 inverted.",
      "fix": "Corrected to bein-max-1→vip1 and bein-max-2→vip2.",
      "liveAtTime": [
        {
          "match": "Ecuador vs Germany",
          "channelId": "bein-max-1",
          "channel": "beIN MAX 1",
          "embedKey": "vip1"
        },
        {
          "match": "Curaçao vs Ivory Coast",
          "channelId": "bein-max-2",
          "channel": "beIN MAX 2",
          "embedKey": "vip2"
        }
      ]
    },
    {
      "date": "2026-06-25T23:42:00.000Z",
      "issue": "Both live cards played Tunisia vs Netherlands (Japan vs Sweden also showed Tunisia).",
      "rootCause": "bein-max-3→vip2 and bein-max-4→vip1 inverted the MAX 3/4 pair (same class of bug as MAX 1/2).",
      "fix": "Alternating map: max-3→vip1, max-4→vip2 (max-N odd→vip1, even→vip2).",
      "liveAtTime": [
        {
          "match": "Japan vs Sweden",
          "channelId": "bein-max-4",
          "channel": "beIN MAX 4",
          "embedKey": "vip2",
          "wasEmbedKey": "vip1"
        },
        {
          "match": "Tunisia vs Netherlands",
          "channelId": "bein-max-3",
          "channel": "beIN MAX 3",
          "embedKey": "vip1",
          "wasEmbedKey": "vip2"
        }
      ],
      "userReport": "Both live matches played Tunisia vs Netherlands"
    }
  ]
};
