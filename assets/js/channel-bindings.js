/* Auto-synced from assets/data/channel-bindings.json by fetch-matches.js */
window.KZ_CHANNEL_BINDINGS = {
  "version": 3,
  "updatedAt": "2026-06-26T00:00:00.000Z",
  "embedBinding": {
    "bein-max-1": "vip1",
    "bein-max-2": "vip2",
    "bein-max-3": "vip2",
    "bein-max-4": "vip1",
    "bein-sports-1": "vip1",
    "bein-sports-2": "vip2"
  },
  "calibration": [
    {
      "date": "2026-06-26T00:00:00.000Z",
      "issue": "Both simultaneous live matches showed the opposite stream (Ecuador/Germany ↔ Curaçao/Ivory Coast).",
      "rootCause": "EMBED_BINDING had bein-max-1→vip2 and bein-max-2→vip1 inverted.",
      "fix": "Corrected to bein-max-1→vip1 and bein-max-2→vip2. live-snapshot.json now records routing on every fetch.",
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
    }
  ]
};
