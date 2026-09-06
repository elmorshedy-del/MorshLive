/* CHATGPT-STAMP 2026-09-06T11:28-04:00 — HOME-STREAM-NOTICE-1
 *
 * Homepage notice only. This does not touch playback, IPTV Lab, routing, or
 * match-card logic. It replaces the stale "stuttering is fixed" message with
 * a transparent service-status update while KoraZero rolls out a new streaming
 * system.
 *
 * Rollback: remove this file and its loader line from assets/js/i18n.js.
 */
(function (global) {
  "use strict";

  const COPY = {
    ar: {
      kicker: "تنويه",
      title: "نعتذر عن مشاكل البث",
      body: "نعتذر عن مشاكل البث التي ظهرت مؤخراً. تعمل KoraZero حالياً على إطلاق نظام بث جديد لتحسين الاستقرار وجودة المشاهدة. قد تحدث بعض الانقطاعات المؤقتة أثناء هذا التحديث، ونحن نعمل على حلها بأسرع وقت. شكراً لصبركم وتفهمكم.",
    },
    en: {
      kicker: "Update",
      title: "We’re upgrading our live streams",
      body: "We’re sorry for the recent streaming issues. KoraZero is rolling out a new streaming system to improve reliability and video quality. Some matches may experience temporary interruptions during the transition. We’re actively working on it and appreciate your patience.",
    },
  };

  function language() {
    if (global.I18N?.lang === "en") return "en";
    const htmlLang = String(document.documentElement.lang || "");
    return /^en\b/i.test(htmlLang) ? "en" : "ar";
  }

  function applyNotice() {
    const title = document.getElementById("season-notice-title");
    const body = document.querySelector('[data-i18n="notice.seasonBody"]');
    const kicker = document.querySelector('[data-i18n="notice.seasonKicker"]');
    if (!title || !body || !kicker) return false;

    const copy = COPY[language()];
    kicker.textContent = copy.kicker;
    title.textContent = copy.title;
    body.textContent = copy.body;

    // Prevent the older dictionary entry from overwriting this status copy later.
    kicker.removeAttribute("data-i18n");
    title.removeAttribute("data-i18n");
    body.removeAttribute("data-i18n");
    return true;
  }

  function start() {
    if (applyNotice()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (applyNotice() || attempts >= 20) clearInterval(timer);
    }, 50);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
  global.addEventListener("pageshow", start);
})(window);
