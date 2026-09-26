# KoraZero GitNexus sidecar

This directory is intentionally deployed from the `infra/gitnexus-sidecar` branch to a separate Railway project. It is not part of the KoraZero production runtime.

## Purpose

- Auto-sync `elmorshedy-del/MorshLive` from `main`
- Auto-sync `elmorshedy-del/KoraZero-StreamV2` from `feature/gateway-control` with `main` as fallback
- Analyze both with GitNexus
- Maintain the cross-repo group `korazero`
- Expose GitNexus MCP over authenticated HTTP

GitNexus data lives under `$GITNEXUS_HOME` (default `/data/gitnexus`). Mount persistent storage at `/data` in the hosting platform.

The MCP server requires `GITNEXUS_MCP_AUTH_TOKEN`. Never commit the token.
