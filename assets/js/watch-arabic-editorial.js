/* Watch-page Arabic editorial layer.
 * Uses familiar Arabic football terminology for lineups, player positions,
 * substitutions, statistics and match-detail labels.
 */
(function () {
  "use strict";

  if (document.documentElement.lang !== "ar" || !window.I18N) return;

  const WATCH_COPY = Object.freeze({
    "card.lineups": "التشكيل الرسمي",
    "card.stats": "إحصائيات المباراة",
    "card.goals": "الأهداف",
    "card.subs": "البدلاء",
    "band.gk": "حارس المرمى",
    "band.def": "الدفاع",
    "band.mid": "الوسط",
    "band.fwd": "الهجوم",
    "watch.channel": "القناة الناقلة",
    "watch.commentator": "المعلق",
    "watch.tournament": "البطولة",
    "watch.matchTime": "موعد المباراة",
    "watch.quality": "جودة البث",
    "watch.package": "الباقة",
    "watch.route": "مصدر البث",
    "watch.sidebar": "مباريات اليوم",
    "watch.live": "مباشر الآن",
    "watch.commentary": "تغطية المباراة",
    "watch.endedCommentary": "انتهت · التغطية متاحة",
    "watch.pressPlay": "اضغط للتشغيل",
    "watch.reload": "إعادة تحميل البث",
    "watch.sourcesToggle": "القنوات ومصادر البث",
    "watch.servers": "مصادر البث",
    "watch.moreServers": "مصادر أخرى",
    "watch.altStreams": "مصادر بديلة",
    "watch.altStreamsNote": "اختر مصدراً واحداً للمشاهدة. لن يتم تحميل بقية المصادر إلا عند اختيارها.",
    "watch.manualMirrorsTitle": "مصادر إضافية",
    "watch.manualMirrorsNote": "اختر المصدر الذي تريد تشغيله. لن ينتقل الموقع تلقائياً بين هذه المصادر.",
    "watch.manualMirrorsPick": "اختر مصدراً من الأعلى للتشغيل",
    "watch.manualMirrorFailed": "تعذر تشغيل هذا المصدر. جرّب مصدراً آخر.",
    "watch.ready": "البث جاهز",
    "watch.noMatches": "لا توجد مباريات متاحة الآن",
    "side.live": "مباشر",
    "side.upcoming": "قادمة",
    "side.ended": "انتهت",
    "side.commentary": "التغطية متاحة"
  });

  const baseT = window.I18N.t.bind(window.I18N);
  window.I18N.t = function watchArabicTranslation(key, vars) {
    const value = WATCH_COPY[key];
    if (value == null) return baseT(key, vars);
    let out = value;
    if (vars) Object.entries(vars).forEach(([k, v]) => {
      out = out.split(`{${k}}`).join(String(v));
    });
    return out;
  };

  const TEXT = [
    [/\bGoalkeeper\b/gi, "حارس المرمى"],
    [/\bKeeper\b/gi, "حارس المرمى"],
    [/\bDefender\b/gi, "مدافع"],
    [/\bDefense\b/gi, "الدفاع"],
    [/\bMidfielder\b/gi, "لاعب وسط"],
    [/\bMidfield\b/gi, "الوسط"],
    [/\bForward\b/gi, "مهاجم"],
    [/\bAttacker\b/gi, "مهاجم"],
    [/\bAttack\b/gi, "الهجوم"],
    [/\bSubstitutes\b/gi, "البدلاء"],
    [/\bSubstitute\b/gi, "بديل"],
    [/\bStarting XI\b/gi, "التشكيل الأساسي"],
    [/\bStarters\b/gi, "التشكيل الأساسي"],
    [/\bاحتياط\b/g, "البدلاء"],
    [/\bانضباط\b/g, "البطاقات"],
    [/Possession(?: Percentage| %)?/gi, "الاستحواذ على الكرة"],
    [/Total Shots/gi, "مجموع التسديدات"],
    [/Shots on Target/gi, "تسديدات على المرمى"],
    [/Corners?/gi, "ركنيات"],
    [/Fouls(?: Committed)?/gi, "أخطاء مرتكبة"],
    [/Offsides?/gi, "تسللات"],
    [/Yellow Cards?/gi, "بطاقات صفراء"],
    [/Red Cards?/gi, "بطاقات حمراء"],
    [/Total Passes/gi, "مجموع التمريرات"],
    [/Pass Accuracy/gi, "دقة التمرير"],
    [/Tackles?/gi, "التحامات"],
    [/Interceptions?/gi, "اعتراضات"],
    [/Clearances?/gi, "تشتيتات"],
    [/Crosses?/gi, "عرضيات"],
    [/Saves?/gi, "تصديات"],
    [/Subbed for/gi, "خرج وشارك بدلاً منه"],
    [/Came on for/gi, "شارك بدلاً من"]
  ];

  function clean(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      let text = node.nodeValue || "";
      const original = text;
      for (const [pattern, replacement] of TEXT) text = text.replace(pattern, replacement);
      if (text !== original) node.nodeValue = text;
    }
  }

  function relabel(root) {
    root.querySelectorAll?.("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (WATCH_COPY[key] != null) el.textContent = window.I18N.t(key);
    });
    clean(root === document ? document.body : root);
  }

  function start() {
    if (!/watch(?:\.html)?$/.test(location.pathname.replace(/\/$/, "")) && !location.pathname.includes("/watch")) return;
    relabel(document);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) relabel(node);
          else if (node.nodeType === Node.TEXT_NODE) clean(node.parentNode);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
