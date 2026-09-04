/* Xtream MPEG-TS recovery guard.
 *
 * watch-xtream.js intentionally owns the actual reconnect policy. This guard
 * only stops a single transient mpegts.js ERROR event from being interpreted
 * as an immediate hard disconnect while media is still advancing.
 */
(function (global) {
  "use strict";

  const mpegts = global.mpegts;
  if (!mpegts?.createPlayer || mpegts.__kzRecoveryGuardInstalled) return;

  const originalCreatePlayer = mpegts.createPlayer.bind(mpegts);
  const errorEvent = mpegts.Events?.ERROR;
  const recoveredEarlyEofEvent = mpegts.Events?.RECOVERED_EARLY_EOF;
  const fatalDetails = new Set([
    mpegts.ErrorDetails?.MEDIA_FORMAT_UNSUPPORTED,
    mpegts.ErrorDetails?.MEDIA_CODEC_UNSUPPORTED,
  ].filter(Boolean));
  const GRACE_MS = 3500;
  const ADVANCE_SECONDS = 0.25;

  mpegts.createPlayer = function guardedCreatePlayer(...args) {
    const player = originalCreatePlayer(...args);
    if (!player || player.__kzRecoveryGuarded) return player;

    let media = null;
    let pendingError = 0;
    let pendingArgs = null;

    const clearPendingError = () => {
      if (pendingError) clearTimeout(pendingError);
      pendingError = 0;
      pendingArgs = null;
    };

    if (typeof player.attachMediaElement === "function") {
      const originalAttach = player.attachMediaElement.bind(player);
      player.attachMediaElement = (element) => {
        media = element || null;
        return originalAttach(element);
      };
    }

    if (typeof player.on === "function" && errorEvent) {
      const originalOn = player.on.bind(player);
      player.on = (event, listener) => {
        if (event !== errorEvent || typeof listener !== "function") {
          return originalOn(event, listener);
        }

        return originalOn(event, (type, detail, info) => {
          // Unsupported formats/codecs are deterministic; delaying them cannot
          // recover playback and would only hide a real failure.
          if (fatalDetails.has(detail)) {
            clearPendingError();
            listener(type, detail, info);
            return;
          }

          // Coalesce error bursts from the same short network interruption.
          pendingArgs = [type, detail, info];
          if (pendingError) return;

          const checkpoint = Number(media?.currentTime || 0);
          pendingError = setTimeout(() => {
            pendingError = 0;
            const current = Number(media?.currentTime || 0);
            const advanced = current > checkpoint + ADVANCE_SECONDS;
            const healthy = !!(
              media &&
              !media.error &&
              !media.ended &&
              (advanced || (media.readyState >= 3 && !media.paused))
            );

            if (healthy) {
              console.info("Xtream TS transient error recovered without remount", type, detail || "");
              pendingArgs = null;
              return;
            }

            const argsToDeliver = pendingArgs || [type, detail, info];
            pendingArgs = null;
            listener(...argsToDeliver);
          }, GRACE_MS);
        });
      };

      if (recoveredEarlyEofEvent) {
        originalOn(recoveredEarlyEofEvent, () => {
          clearPendingError();
        });
      }
    }

    if (typeof player.destroy === "function") {
      const originalDestroy = player.destroy.bind(player);
      player.destroy = () => {
        clearPendingError();
        media = null;
        return originalDestroy();
      };
    }

    player.__kzRecoveryGuarded = true;
    return player;
  };

  mpegts.__kzRecoveryGuardInstalled = true;
})(window);
