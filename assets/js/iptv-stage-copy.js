/* Normalize non-IPTV watch-page waiting copy across supported leagues.
 * Saudi used to have a rollout-specific "coming soon" message. Now the copy is
 * stage-based for every league: before TV window, resolving inside the window,
 * or live TV window finished.
 */
(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  const matchId = String(params.get("match") || "");
  if (!matchId || params.get("source") === "xtream") return;

  let currentMatch = null;
  let observer = null;
  let refreshTimer = 0;

  function lang() {
    return window.I18N?.lang === "en" ? "en" : "ar";
  }

  function copyFor(phase) {
    if (lang() === "en") {
      if (phase === "details") {
        return {
          kicker: "Before the match",
          title: "TV opens about 30 minutes before kickoff",
          hint: "The channel player activates automatically when the pre-match studio window begins. Match details are available now.",
          live: "Match details available",
        };
      }
      if (phase === "after") {
        return {
          kicker: "Full time",
          title: "The live TV window has ended",
          hint: "You can continue with the match summary, goals and available replay content below.",
          live: "Summary and details available",
        };
      }
      return {
        kicker: "Live TV",
        title: "Preparing the match channel",
        hint: "The broadcaster assignment is resolved automatically, with the provider EPG used as a fail-closed fallback when needed.",
        live: "This page updates automatically",
      };
    }

    if (phase === "details") {
      return {
        kicker: "قبل المباراة",
        title: "يفتح البث قبل المباراة بنحو 30 دقيقة",
        hint: "يُفعّل مشغل القناة تلقائياً مع بداية الاستوديو التحليلي. تفاصيل المباراة متاحة الآن.",
        live: "تفاصيل المباراة متاحة",
      };
    }
    if (phase === "after") {
      return {
        kicker: "بعد النهاية",
        title: "انتهت نافذة البث المباشر",
        hint: "يمكنك متابعة ملخص المباراة والأهداف والمحتوى المتاح بعد المباراة أدناه.",
        live: "الملخص والتفاصيل متاحة",
      };
    }
    return {
      kicker: "البث المباشر",
      title: "جاري تحديد قناة المباراة",
      hint: "يتم ربط القناة تلقائياً من بيانات الناقل، مع استخدام جدول القناة كمسار احتياطي عند الحاجة.",
      live: "تتحدث هذه الصفحة تلقائياً",
    };
  }

  function renderWaiting() {
    if (!currentMatch || !window.KZIptvWindow) return;
    const waiting = document.querySelector("#player-shell .player-shell-waiting");
    if (!waiting) return;
    const phase = window.KZIptvWindow.phase(currentMatch);
    const copy = copyFor(phase);
    const signature = `${phase}:${lang()}`;
    if (waiting.dataset.iptvStageCopy === signature) return;

    waiting.classList.remove("player-shell-waiting--soon");
    waiting.dataset.iptvStageCopy = signature;
    waiting.dataset.planWait = phase;
    waiting.innerHTML = "";

    const kicker = document.createElement("p");
    kicker.className = "player-shell-waiting__kicker";
    kicker.textContent = copy.kicker;
    const title = document.createElement("strong");
    title.textContent = copy.title;
    const hint = document.createElement("span");
    hint.textContent = copy.hint;
    const live = document.createElement("em");
    live.className = "player-shell-waiting__live";
    live.textContent = copy.live;
    waiting.append(kicker, title, hint, live);
  }

  async function loadMatch() {
    if (typeof window.getMatches !== "function") return;
    try {
      const data = await window.getMatches({ force: false });
      currentMatch = (data?.matches || []).find((match) => String(match.id) === matchId) || currentMatch;
      renderWaiting();
    } catch {}
  }

  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === "childList" && mutation.addedNodes.length)) renderWaiting();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  async function init() {
    for (let i = 0; i < 80 && typeof window.getMatches !== "function"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    startObserver();
    await loadMatch();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(loadMatch, 45 * 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
