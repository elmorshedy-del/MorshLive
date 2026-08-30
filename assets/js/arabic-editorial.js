/* Final Arabic editorial pass for user-facing copy.
 * Keep high-value search phrases natural, use familiar football terminology,
 * and avoid presenting regional time zones as a product feature.
 */
(function () {
  "use strict";

  if (document.documentElement.lang !== "ar" || !window.I18N) return;

  const COPY = Object.freeze({
    "seo.title": "مباريات اليوم بث مباشر HD بدون تقطيع | كورة زيرو",
    "seo.description":
      "تابع مباريات اليوم بث مباشر HD بدون تقطيع على كورة زيرو، مع مواعيد المباريات والنتائج المباشرة والقنوات الناقلة والمعلقين عند توفر البيانات.",
    "seo.ogTitle": "مباريات اليوم بث مباشر | كورة زيرو",
    "seo.ogDescription":
      "مباريات اليوم في مكان واحد: بث مباشر بجودة HD، نتائج مباشرة، مواعيد المباريات، القنوات الناقلة والمعلقون.",
    "seo.twitterDescription":
      "تابع مباريات اليوم بث مباشر ونتائج مباشرة، مع المواعيد والقنوات الناقلة والمعلقين على كورة زيرو.",
    "seo.slogan": "مباريات اليوم بث مباشر ونتائج مباشرة",
    "seo.keywordsAria": "معلومات مباريات اليوم",
    "seo.kw1": "مباريات اليوم",
    "seo.kw2": "بث مباشر HD",
    "seo.kw3": "بث مباشر بدون تقطيع",
    "seo.kw4": "نتائج مباشرة",
    "seo.kw5": "القنوات الناقلة",
    "seo.kw6": "المواعيد بتوقيتك",

    "hero.title": "مباريات اليوم بث مباشر — <span>HD وبدون تقطيع</span>",
    "hero.lede":
      "تابع مباريات اليوم بث مباشر بجودة HD وبدون تقطيع، مع النتائج المباشرة ومواعيد المباريات والقنوات الناقلة والمعلقين. تظهر المواعيد حسب توقيت جهازك تلقائياً.",
    "hero.noAds": "بدون إعلانات مزعجة أو نوافذ منبثقة",
    "hero.usp1": "بدون إعلانات مزعجة",
    "hero.usp2": "بث مباشر HD",
    "hero.usp3": "بدون تقطيع",
    "hero.usp4": "القناة والمعلق لكل مباراة",
    "hero.ctaLive": "شاهد البث المباشر",
    "hero.seasonTitle": "تفاصيل المباراة",
    "hero.seasonLede":
      "تابع التشكيل الرسمي والنتيجة والأهداف وإحصائيات المباراة من صفحة المباراة عند توفر البيانات.",
    "hero.ctaMatches": "مباريات اليوم",

    "matches.title": "مباريات اليوم",
    "matches.lede":
      "جدول مباريات اليوم والمباريات القادمة، مع المواعيد والنتائج والقنوات الناقلة والمعلقين عند توفرها.",
    "coverage.live": "مباشر",
    "coverage.lineups": "التشكيل",
    "coverage.stats": "الإحصائيات",
    "card.lineups": "التشكيل الرسمي",
    "card.stats": "إحصائيات المباراة",
    "card.summary": "ملخص المباراة",
    "card.watchNow": "شاهد الآن",
    "card.watch": "مشاهدة",
    "status.live": "مباشر الآن",
    "status.upcoming": "لم تبدأ",
    "status.ended": "انتهت",
    "live.empty": "لا توجد مباريات مباشرة الآن. راجع جدول مباريات اليوم.",
    "live.recentEnded": "انتهت قبل قليل · التغطية متاحة",

    "faq.title": "الأسئلة الشائعة",
    "faq.q1": "ما المعلومات المتاحة لكل مباراة؟",
    "faq.a1":
      "موعد المباراة والنتيجة المباشرة والتشكيل والإحصائيات والأهداف، إضافة إلى القناة والمعلق ورابط المشاهدة عند توفر البث.",
    "faq.q2": "ما البطولات التي يغطيها كورة زيرو؟",
    "faq.a2":
      "يغطي كورة زيرو أهم مباريات الدوري السعودي والدوري الإنجليزي والدوري الإسباني ودوري أبطال أوروبا، مع إضافة البطولات والمباريات المتاحة إلى الجدول.",
    "faq.q3": "بأي توقيت تظهر مواعيد المباريات؟",
    "faq.a3": "يظهر موعد كل مباراة حسب توقيت جهازك تلقائياً.",

    "footer.about":
      "تابع مباريات اليوم والمواعيد والنتائج المباشرة والقنوات الناقلة والمعلقين، وافتح صفحة المباراة للتشكيل والإحصائيات والتفاصيل الكاملة.",
    "footer.disclaimer":
      "قد تعتمد بعض المشاهدات على مصادر خارجية. حقوق البث والعلامات التجارية محفوظة لأصحابها، وتطبق القواعد المعمول بها في بلدك.",

    "updated.prefix": "المصدر:",
    "updated.lastUpdate": "آخر تحديث",
    "updated.auto": "يتحدث تلقائياً",
    "updated.demo": "تعذر تحميل الجدول المباشر، لذلك تظهر بيانات احتياطية.",

    "search.title": "ابحث عن مباراة",
    "search.lede": "ابحث باسم الفريق أو البطولة أو المعلق للوصول إلى المباراة بسرعة.",
    "search.placeholder": "فريق أو بطولة أو معلق…",
    "search.prompt": "اكتب اسم فريق أو بطولة للبحث.",
    "search.none": "لا توجد نتائج لـ «{q}».",

    "watch.cleanView": "مشاهدة بدون إعلانات مزعجة",
    "watch.sourceToggle": "اختر البث",
    "watch.sourcesToggle": "القنوات ومصادر البث",
    "watch.servers": "مصادر البث",
    "watch.moreServers": "مصادر أخرى",
    "watch.altStreams": "مصادر بديلة",
    "watch.manualMirrorsTitle": "مصادر إضافية",
    "watch.manualMirrorsPick": "اختر مصدراً للتشغيل",
    "watch.ready": "جاهز للمشاهدة",
    "watch.matchTime": "موعد المباراة",
    "watch.channel": "القناة",
    "watch.commentator": "المعلق",
    "watch.tournament": "البطولة",
    "watch.noMatches": "لا توجد مباريات متاحة الآن",

    "srv.checking": "جارٍ التحقق من مصادر البث…",
    "srv.okPrefix": "المصادر المتاحة:",
    "srv.okSuffix": "— اللون الأخضر يعني أن المصدر جاهز للتشغيل",
    "srv.down": "لم نتمكن من تأكيد مصدر يعمل الآن. يمكنك تجربة المصادر يدوياً.",
    "srv.working": "متاح",
    "srv.noAudio": "بدون صوت",
    "srv.hasAudio": "الصوت متاح",
    "srv.unreachable": "المصدر غير متاح الآن",
    "srv.checkingOne": "جارٍ التحقق من المصدر…",
  });

  const baseT = window.I18N.t.bind(window.I18N);
  function interpolate(value, vars) {
    let result = String(value);
    if (!vars) return result;
    Object.entries(vars).forEach(([key, replacement]) => {
      result = result.split(`{${key}}`).join(String(replacement));
    });
    return result;
  }

  window.I18N.t = function polishedArabic(key, vars) {
    const value = COPY[key];
    return value == null ? baseT(key, vars) : interpolate(value, vars);
  };

  const TEXT_REPLACEMENTS = [
    [/\bأدناه\b/g, "في الجدول"],
    [/\bادناه\b/g, "في الجدول"],
    [/بتوقيت الرياض والتوقيت الشرقي الأمريكي(?: \(ET\))?/g, "حسب توقيت جهازك"],
    [/بتوقيت الرياض وET/g, "حسب توقيت جهازك"],
    [/بتوقيت السعودية/g, "حسب توقيت جهازك"],
    [/التوقيت الشرقي الأمريكي \(ET\)/g, "توقيت جهازك"],
  ];

  function cleanText(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      let value = node.nodeValue || "";
      const original = value;
      for (const [pattern, replacement] of TEXT_REPLACEMENTS) {
        value = value.replace(pattern, replacement);
      }
      if (value !== original) node.nodeValue = value;
    }
  }

  function applyStaticCopy(root = document) {
    root.querySelectorAll?.("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (COPY[key] != null) el.textContent = window.I18N.t(key);
    });
    root.querySelectorAll?.("[data-i18n-html]").forEach((el) => {
      const key = el.getAttribute("data-i18n-html");
      if (COPY[key] != null) el.innerHTML = window.I18N.t(key);
    });
  }

  function setMeta(selector, content) {
    const el = document.querySelector(selector);
    if (el && content) el.setAttribute("content", content);
  }

  function applyMeta() {
    document.title = window.I18N.t("seo.title");
    setMeta('meta[name="description"]', window.I18N.t("seo.description"));
    setMeta('meta[property="og:title"]', window.I18N.t("seo.ogTitle"));
    setMeta('meta[property="og:description"]', window.I18N.t("seo.ogDescription"));
    setMeta('meta[name="twitter:title"]', window.I18N.t("seo.ogTitle"));
    setMeta('meta[name="twitter:description"]', window.I18N.t("seo.twitterDescription"));
  }

  function removeHomepageTimezoneMarketing() {
    document.querySelectorAll(".hero-keyword").forEach((el) => {
      if (/الرياض|السعودية|\bET\b|توقيت جهازك/.test(el.textContent || "")) el.remove();
    });
  }

  function apply(root = document) {
    applyStaticCopy(root);
    cleanText(root === document ? document.body : root);
    removeHomepageTimezoneMarketing();
    applyMeta();
  }

  let queued = false;
  const observer = new MutationObserver((mutations) => {
    if (queued) return;
    const relevant = mutations.some((mutation) => mutation.addedNodes.length > 0);
    if (!relevant) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) apply(node);
          else if (node.nodeType === Node.TEXT_NODE) cleanText(node.parentNode);
        });
      }
    });
  });

  function start() {
    apply();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
