/* CHATGPT-STAMP 2026-09-06 — HOME-STREAM-NOTICE-3
 *
 * Homepage notice only. This does not touch playback, IPTV Lab, routing, or
 * match-card logic. Arabic wording follows natural service-status phrasing used
 * by telecom and digital-service providers: temporary impact, active technical
 * teams, restoring stability, and thanking users for their patience.
 *
 * Rollback: restore the previous version of this file.
 */
(function (global) {
  "use strict";

  const COPY = {
    ar: {
      kicker: "تنويه",
      title: "نعمل على تحسين البث",
      body: "نعتذر عن أي اضطرابات واجهتكم مؤخراً أثناء المشاهدة. نعمل حالياً على تطوير نظام البث لتحسين الاستقرار وجودة المشاهدة. خلال فترة التحديث، قد تتأثر بعض المباريات بشكل مؤقت. تعمل فرقنا الفنية على معالجة أي مشكلة فور حدوثها وإعادة استقرار الخدمة بأسرع وقت ممكن. نشكركم على تفهمكم وصبركم.",
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
