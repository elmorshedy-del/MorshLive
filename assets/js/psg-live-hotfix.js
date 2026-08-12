/* Emergency PSG vs Aston Villa playback router.
 * Keeps this one pinned match off raw popup-heavy upstream pages and cycles
 * through KoraZero's clean same-origin resolvers until video is actually moving.
 */
(function () {
  const PSG_RE = /(aston villa|paris saint-germain|paris saint germain|paris sg|\bpsg\b)/i;
  const SOURCES = [
    "/wk/albaplayer/kooracity/?home=Paris%20Saint-Germain&away=Aston%20Villa",
    "/sir/ar1/",
    "/sir/ar2/",
    "https://912acsss8af382.fabortvcdn.com/playerv5.php?match=4728413&key=9f39972b67d6ce22189507d008acwc26",
  ];

  let sourceIndex = 0;
  let activeFrame = null;
  let checkTimer = null;
  let mounted = false;

  function isPsgVillaPage() {
    const title = document.title || "";
    const ch = document.getElementById("ch-name")?.textContent || "";
    return /aston villa/i.test(title + " " + ch) && PSG_RE.test(title + " " + ch);
  }

  function clearCheck() {
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = null;
  }

  function mountSource(index) {
    const shell = document.getElementById("player-shell");
    if (!shell || !isPsgVillaPage()) return;
    clearCheck();
    sourceIndex = Math.min(index, SOURCES.length - 1);
    const src = SOURCES[sourceIndex];
    shell.innerHTML = "";
    const frame = document.createElement("iframe");
    frame.className = "embed-frame psg-hotfix-frame";
    frame.src = src;
    frame.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
    frame.allowFullscreen = true;
    frame.scrolling = "no";
    frame.loading = "eager";
    frame.referrerPolicy = sourceIndex < 3 ? "same-origin" : "no-referrer";
    shell.appendChild(frame);
    activeFrame = frame;

    frame.addEventListener("load", function () {
      if (frame !== activeFrame) return;
      // Same-origin clean KoraZero players can be health-checked by observing
      // actual playback rather than treating an iframe load as success.
      if (sourceIndex < 3) schedulePlaybackCheck(frame, sourceIndex);
    });

    // Network/load failure guard. If the clean route never finishes loading,
    // move on instead of leaving a permanent black rectangle.
    if (sourceIndex < 3) {
      checkTimer = setTimeout(function () {
        if (frame === activeFrame) mountSource(sourceIndex + 1);
      }, 12000);
    }
  }

  function schedulePlaybackCheck(frame, indexAtMount) {
    clearCheck();
    let firstTime = null;
    const inspect = function () {
      if (frame !== activeFrame || indexAtMount !== sourceIndex) return;
      try {
        const doc = frame.contentDocument;
        const text = (doc?.body?.innerText || "").toLowerCase();
        const video = doc?.querySelector("video");
        if (/غير متاح|unavailable|upstream unavailable|forbidden/.test(text)) {
          mountSource(sourceIndex + 1);
          return;
        }
        if (video) {
          const now = Number(video.currentTime || 0);
          if (firstTime == null) firstTime = now;
          if (!video.paused && video.readyState >= 2 && now > firstTime + 0.5) {
            clearCheck();
            return; // confirmed moving video
          }
        }
      } catch (_) {
        // Should not happen for same-origin routes; treat as inconclusive.
      }
      if (sourceIndex < 2) mountSource(sourceIndex + 1);
      else mountSource(3); // final cross-origin fallback
    };
    checkTimer = setTimeout(inspect, 9000);
  }

  function tryMount() {
    if (!isPsgVillaPage()) return;
    const shell = document.getElementById("player-shell");
    if (!shell) return;
    // watch.js may repaint during initial fixture refresh; reassert the hotfix
    // until our own frame is mounted, then observe and restore if overwritten.
    if (!mounted || !shell.querySelector(".psg-hotfix-frame")) {
      mounted = true;
      mountSource(sourceIndex);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(tryMount, 700);
    setTimeout(tryMount, 2200);
    const shell = document.getElementById("player-shell");
    if (shell) {
      new MutationObserver(function () {
        if (isPsgVillaPage() && !shell.querySelector(".psg-hotfix-frame")) {
          setTimeout(tryMount, 50);
        }
      }).observe(shell, { childList: true });
    }
  });
})();
