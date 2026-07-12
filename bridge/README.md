# MorshLive Bridge — Experimental

Headless Chromium opens go4score.app as a top-level page (no iframe restrictions), ffmpeg captures + re-encodes to clean HLS.

## Deploy

```bash
cd bridge
PORT=80 docker compose up -d
```

## Create a stream

Open `http://<bridge-ip>/ui/` → New Stream:
- URL: `https://go4score.app/?m=30733&lang=en`
- Slug: `bein-max2-ar`
- Scale: `1280x720`, Bitrate: `2500k`, Preset: `ultrafast`, Tune: `zerolatency`

Use VNC (`http://<bridge-ip>/ui/vnc/bein-max2-ar/`) to click "beIN MAX 2 (AR)".

## Stream URL

```
http://<bridge-ip>/hls/live/bein-max2-ar/index.m3u8
```

Embed this on korazero.com via the experimental bridge source option.
