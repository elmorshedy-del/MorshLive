/* ============================================================================
 * i18n.js — Arabic/English toggle. Default Arabic (RTL); English flips to LTR.
 *
 * Loads FIRST so window.I18N exists before data.js / app.js / watch.js render —
 * those call I18N.t(key) for their generated strings. Static markup is tagged
 * with data-i18n / data-i18n-attr and translated on load. Switching language
 * persists the choice and reloads, so every string (static + JS-built) comes
 * out in the chosen language with no partial-translation glitches.
 * ==========================================================================*/
(function (global) {
  "use strict";

  const DICT = {
    ar: {
      "nav.home": "الرئيسية",
      "nav.matches": "مباريات اليوم",
      "nav.saved": "المحفوظة",
      "nav.faq": "الأسئلة الشائعة",
      "nav.live": "البث المباشر",
      "nav.menu": "القائمة",
      "bookmark.save": "احفظ الموقع",
      "bookmark.aria": "احفظ الموقع في المفضلة",
      "lang.toggle": "EN",
      "lang.toggleFull": "English",
      "lang.toggleAria": "Switch to English",
      "tv.toggle": "وضع التلفزيون",
      "tv.toggleOn": "وضع التلفزيون: مفعّل",
      "tv.toggleAria": "تفعيل وضع التلفزيون",
      "tv.toggleAriaOff": "إيقاف وضع التلفزيون",
      "wc.hosts": "أمريكا · كندا · المكسيك",
      "wc.live": "جارٍ الآن",
      "hero.noAds": "بدون إعلانات ولا نوافذ منبثقة",
      "seo.title": "بث مباشر مباريات اليوم وكأس العالم 2026 بدون إعلانات | كورة زيرو",
      "seo.description": "شاهد بث مباشر مباريات اليوم وكأس العالم 2026 أون لاين بجودة HD على كورة زيرو. بديل نظيف ليلا شوت وكورة لايف — بدون إعلانات ولا نوافذ منبثقة ولا تقطيع، مع مواعيد المباريات بتوقيت السعودية والمعلّق العربي.",
      "seo.ogTitle": "بث مباشر مباريات اليوم وكأس العالم 2026 بدون إعلانات | كورة زيرو",
      "seo.ogDescription": "شاهد بث مباشر مباريات اليوم وكأس العالم 2026 أون لاين بجودة HD على كورة زيرو. بديل نظيف ليلا شوت وكورة لايف — بدون إعلانات ولا نوافذ منبثقة ولا تقطيع.",
      "seo.twitterDescription": "كورة اون لاين — بث مباشر مباريات اليوم وكأس العالم 2026 بجودة HD بدون إعلانات ولا نوافذ منبثقة.",
      "seo.keywordsAria": "مواضيع البث والمباريات",
      "seo.kw1": "كورة اون لاين",
      "seo.kw2": "مونديال 2026",
      "seo.kw3": "بين سبورت",
      "seo.kw4": "بث مباشر HD",
      "hero.title": "بث مباشر مباريات اليوم وكأس العالم 2026 — <span>كورة أون لاين</span> بجودة HD بدون إعلانات",
      "hero.lede": "كورة زيرو موقعك الأول لمشاهدة بث مباشر مباريات اليوم ومباريات كأس العالم 2026 (مونديال 2026) أون لاين بجودة HD. بديل نظيف وآمن لمواقع يلا شوت وكورة لايف — بدون إعلانات، بدون نوافذ منبثقة، وبدون تقطيع. تابع مباريات بين سبورت والمونديال لحظة بلحظة، مع مواعيد المباريات بتوقيت السعودية وشرق أمريكا والمعلّق العربي لكل مباراة.",
      "hero.usp1": "بدون إعلانات",
      "hero.usp2": "بدون نوافذ منبثقة",
      "hero.usp3": "بدون تقطيع",
      "hero.usp4": "السيرفر العامل مميّز تلقائيًا",
      "hero.ctaLive": "شاهد المباشر الآن",
      "hero.ctaMatches": "مباريات اليوم",
      "saved.title": "المباريات المحفوظة",
      "matches.title": "مباريات اليوم بث مباشر",
      "filter.all": "الكل",
      "filter.live": "مباشر الآن",
      "filter.upcoming": "قادمة",
      "filter.ended": "منتهية",
      "faq.title": "الأسئلة الشائعة",
      "faq.q1": "كيف أشاهد مباريات اليوم بث مباشر بدون إعلانات؟",
      "faq.a1": "افتح KoraZero واختر المباراة أو القناة، وسيبدأ البث المباشر مباشرة في المتصفح بجودة عالية — بدون إعلانات ولا نوافذ منبثقة ولا تقطيع، وبدون تسجيل أو اشتراك.",
      "faq.q2": "هل يمكن متابعة كأس العالم 2026 بث مباشر؟",
      "faq.a2": "نعم، يوفّر KoraZero تغطية مباشرة لمباريات كأس العالم 2026™ مع مواعيد المباريات، القنوات الناقلة (بي إن سبورت ماكس) واسم المعلّق لكل مباراة.",
      "faq.q3": "بأي توقيت تظهر مواعيد المباريات؟",
      "faq.a3": "تُعرض مواعيد كل مباراة بتوقيت السعودية وبتوقيت شرق أمريكا (ET) لتتابع المباراة في وقتها الصحيح أينما كنت.",
      "faq.q4": "كيف أعرف السيرفر العامل والمعلّق لكل مباراة؟",
      "faq.a4": "يفحص KoraZero السيرفرات تلقائيًا ويميّز العامل منها باللون الأخضر، ويعرض اسم المعلّق والقناة الناقلة لكل مباراة حتى لا تبحث بنفسك.",
      "faq.q6": "هل كورة زيرو بديل ليلا شوت وكورة لايف؟",
      "faq.a6": "نعم — كورة زيرو (كورة اون لاين) يوفّر بث مباشر مباريات اليوم وكأس العالم 2026 بواجهة نظيفة بدون إعلانات ولا نوافذ منبثقة ولا تقطيع، مع المعلّق العربي والقناة الناقلة لكل مباراة.",
      "footer.about": "وجهتك لمشاهدة مباريات اليوم وكأس العالم 2026 بث مباشر بجودة عالية — بدون إعلانات، بدون نوافذ منبثقة، وبدون تقطيع. مواعيد المباريات بتوقيت السعودية وشرق أمريكا، مع القنوات الناقلة والمعلّق لكل مباراة على جميع الأجهزة.",
      "footer.disclaimer": "البث من مصادر خارجية تابعة لأصحابها. يُرجى احترام حقوق النقل المعمول بها في بلدك.",
      "footer.quickLinks": "روابط سريعة",
      "footer.tournaments": "البطولات",
      "footer.bottom": "© 2026 KoraZero · صُمم بواجهة نظيفة وبدون إعلانات.",
      "footer.bottomShort": "© 2026 KoraZero · واجهة بدون إعلانات.",
      "league.wc": "كأس العالم 2026",
      "league.epl": "الدوري الإنجليزي",
      "league.ucl": "دوري أبطال أوروبا",
      "league.spl": "الدوري السعودي",
      // status / cards
      "status.live": "مباشر الآن",
      "status.upcoming": "لم تبدأ",
      "status.ended": "انتهت",
      "card.watch": "مشاهدة",
      "card.ended": "انتهت",
      "card.watchCommentary": "مشاهدة التعليق",
      "card.watchNow": "شاهد الآن",
      "card.saveMatch": "حفظ المباراة",
      "card.removeSaved": "إزالة من المحفوظة",
      "matches.none": "لا توجد مباريات في هذا التصنيف.",
      "matches.count": "{n} مباراة",
      "live.empty": "لا توجد مباريات مباشرة الآن — تابع مباريات اليوم بالأسفل.",
      "live.now": "مباشر الآن",
      "live.recentEnded": "انتهت للتو · التعليق متاح",
      "updated.prefix": "مصدر:",
      "updated.lastUpdate": "آخر تحديث",
      "updated.auto": "يتحدث تلقائياً",
      "updated.demo": "بيانات تجريبية (تعذّر تحميل الجدول المباشر)",
      "saved.none": "لا توجد مباريات محفوظة بعد.",
      // bookmark hints
      "bookmark.hintMac": "اضغط ⌘ + D لإضافة الموقع إلى المفضلة.",
      "bookmark.hintWin": "اضغط Ctrl + D لإضافة الموقع إلى المفضلة.",
      "bookmark.hintTv": "للحفظ: افتح قائمة المتصفح بالريموت واختر «إضافة إلى المفضلة».",
      // watch page
      "watch.cleanView": "مشاهدة نظيفة بدون إعلانات",
      "watch.player1": "مشغّل 1",
      "watch.player2": "مشغّل 2 VIP",
      "watch.channel": "القناة",
      "watch.pressPlay": "اضغط للتشغيل",
      "watch.quality": "الجودة",
      "watch.package": "الباقة",
      "watch.route": "مسار البث",
      "watch.commentator": "المعلّق",
      "watch.tournament": "البطولة",
      "watch.matchTime": "توقيت المباراة",
      "watch.disclaimer": 'بدّل بين <b>مشغّل 1</b> و<b>مشغّل 2 VIP</b> أعلى الفيديو، واختر السيرفر المميّز بالأخضر لأفضل بث.',
      "watch.sidebar": "مباريات اليوم",
      "watch.live": "مباشر الآن",
      "watch.commentary": "التعليق متاح",
      "watch.endedCommentary": "انتهت · شاهد التعليق",
      "watch.ready": "جاهزة للبث",
      "watch.titleSuffix": "مشاهدة مباشرة | KoraZero",
      "watch.pressToPlayQ": "اضغط للتشغيل · جودة",
      "watch.vs": "ضد",
      "watch.server": "سيرفر",
      "watch.vipServer": "VIP سيرفر",
      "watch.serverHd": "سيرفر 1 · HD",
      "watch.serverSd": "سيرفر 2 · SD",
      "watch.serverBackup": "سيرفر 3 · احتياطي",
      "watch.noMatches": "لا توجد مباريات متاحة الآن",
      "side.live": "مباشر",
      "side.upcoming": "قادمة",
      "side.ended": "انتهت",
      "side.commentary": "التعليق",
      "tz.ksa": "بتوقيت السعودية",
      "tz.ksaShort": "السعودية",
      "tz.et": "بتوقيت شرق أمريكا (ET)",
      "tz.etShort": "شرق أمريكا",
      "tz.dash": "—",
      // stream-check
      "srv.checking": "🔎 جارٍ فحص السيرفرات وتحديد العامل منها…",
      "srv.okPrefix": "تم تمييز",
      "srv.okSuffix": "سيرفر متاح — المظلّل بالأخضر يعمل",
      "srv.muteSuffix": "منها بدون صوت 🔇",
      "srv.down": "⚠️ تعذّر تأكيد عمل السيرفرات الآن — يمكنك التجربة يدويًا",
      "srv.working": "يعمل",
      "srv.noAudio": "بدون صوت",
      "srv.hasAudio": "صوت ✓",
      "srv.unreachable": "تعذّر الوصول لهذا السيرفر",
      "srv.checkingOne": "جارٍ فحص السيرفر…",
    },
    en: {
      "nav.home": "Home",
      "nav.matches": "Today's matches",
      "nav.saved": "Saved",
      "nav.faq": "FAQ",
      "nav.live": "Live",
      "nav.menu": "Menu",
      "bookmark.save": "Bookmark site",
      "bookmark.aria": "Add this site to favorites",
      "lang.toggle": "ع",
      "lang.toggleFull": "العربية",
      "lang.toggleAria": "التبديل إلى العربية",
      "tv.toggle": "TV mode",
      "tv.toggleOn": "TV mode: on",
      "tv.toggleAria": "Enable TV mode",
      "tv.toggleAriaOff": "Disable TV mode",
      "wc.hosts": "USA · Canada · Mexico",
      "wc.live": "Live now",
      "hero.noAds": "No ads, no pop-ups",
      "seo.title": "KoraZero — Live streams, today's matches & World Cup 2026 HD, no ads",
      "seo.description": "Watch today's matches and FIFA World Cup 2026 live in HD on KoraZero — a clean, ad-free football stream with Arabic commentary, Saudi & US Eastern kick-off times, and beIN Sports MAX channels.",
      "seo.ogTitle": "KoraZero — Live football streams World Cup 2026 HD, no ads",
      "seo.ogDescription": "Watch today's matches and World Cup 2026 live in HD on KoraZero — no ads, no pop-ups, no buffering.",
      "seo.twitterDescription": "KoraZero — live football streams, World Cup 2026 HD, ad-free.",
      "seo.keywordsAria": "Streaming topics",
      "seo.kw1": "Football online",
      "seo.kw2": "World Cup 2026",
      "seo.kw3": "beIN Sports",
      "seo.kw4": "HD live stream",
      "hero.title": "Live streams — today's matches & <span>World Cup 2026</span> online in HD, ad-free",
      "hero.lede": "KoraZero is your home for today's matches and FIFA World Cup 2026™ live in HD — no ads, no pop-ups, no buffering. Follow every game with Arabic commentary, beIN Sports MAX channels, and kick-off times in Saudi and US Eastern time.",
      "hero.usp1": "No ads",
      "hero.usp2": "No pop-ups",
      "hero.usp3": "No buffering",
      "hero.usp4": "Working server auto-highlighted",
      "hero.ctaLive": "Watch live now",
      "hero.ctaMatches": "Today's matches",
      "saved.title": "Saved matches",
      "matches.title": "Today's matches — live",
      "filter.all": "All",
      "filter.live": "Live now",
      "filter.upcoming": "Upcoming",
      "filter.ended": "Ended",
      "faq.title": "FAQ",
      "faq.q1": "How do I watch today's matches live with no ads?",
      "faq.a1": "Open KoraZero and pick a match or channel — the live stream starts right in your browser in high quality, with no ads, no pop-ups, no buffering, and no sign-up or subscription.",
      "faq.q2": "Can I follow the World Cup 2026 live?",
      "faq.a2": "Yes — KoraZero provides live coverage of the FIFA World Cup 2026™ with kick-off times, the broadcast channels (beIN Sports MAX) and the commentator for every match.",
      "faq.q3": "What time zone are the kick-off times shown in?",
      "faq.a3": "Each match time is shown in both Saudi time and US Eastern time (ET), so you can catch the match at the right time wherever you are.",
      "faq.q4": "How do I know the working server and the commentator for each match?",
      "faq.a4": "KoraZero checks the servers automatically and highlights the working one in green, and shows the commentator and broadcast channel for every match so you don't have to search.",
      "faq.q6": "Is KoraZero an alternative to ad-heavy stream sites?",
      "faq.a6": "Yes — KoraZero offers today's matches and World Cup 2026 live in a clean interface with no ads, no pop-ups, no buffering, plus Arabic commentary and the broadcast channel for every match.",
      "footer.about": "Your destination to watch today's matches and the World Cup 2026 live in high quality — no ads, no pop-ups, no buffering. Kick-off times in Saudi and US Eastern time, with the broadcast channel and commentator for every match on all devices.",
      "footer.disclaimer": "Streams come from third-party sources owned by their respective holders. Please respect the broadcasting rights that apply in your country.",
      "footer.quickLinks": "Quick links",
      "footer.tournaments": "Tournaments",
      "footer.bottom": "© 2026 KoraZero · A clean, ad-free experience.",
      "footer.bottomShort": "© 2026 KoraZero · Ad-free interface.",
      "league.wc": "World Cup 2026",
      "league.epl": "Premier League",
      "league.ucl": "UEFA Champions League",
      "league.spl": "Saudi Pro League",
      "status.live": "Live now",
      "status.upcoming": "Not started",
      "status.ended": "Ended",
      "card.watch": "Watch",
      "card.ended": "Ended",
      "card.watchCommentary": "Watch commentary",
      "card.watchNow": "Watch now",
      "card.saveMatch": "Save match",
      "card.removeSaved": "Remove from saved",
      "matches.none": "No matches in this category.",
      "matches.count": "{n} matches",
      "live.empty": "No live matches right now — check today's matches below.",
      "live.now": "Live now",
      "live.recentEnded": "Just ended · commentary available",
      "updated.prefix": "Source:",
      "updated.lastUpdate": "last updated",
      "updated.auto": "auto-refreshing",
      "updated.demo": "Demo data (couldn't load the live schedule)",
      "saved.none": "No saved matches yet.",
      "bookmark.hintMac": "Press ⌘ + D to add this site to your favorites.",
      "bookmark.hintWin": "Press Ctrl + D to add this site to your favorites.",
      "bookmark.hintTv": "To save: open the browser menu with your remote and choose “Add to favorites”.",
      "watch.cleanView": "Clean, ad-free viewing",
      "watch.player1": "Player 1",
      "watch.player2": "Player 2 VIP",
      "watch.channel": "Channel",
      "watch.pressPlay": "Press to play",
      "watch.quality": "Quality",
      "watch.package": "Package",
      "watch.route": "Stream route",
      "watch.commentator": "Commentator",
      "watch.tournament": "Tournament",
      "watch.matchTime": "Match time",
      "watch.disclaimer": 'Switch between <b>Player 1</b> and <b>Player 2 VIP</b> above the video, and pick the server highlighted green for the best stream.',
      "watch.sidebar": "Today's matches",
      "watch.live": "Live now",
      "watch.commentary": "Commentary available",
      "watch.endedCommentary": "Full time · watch commentary",
      "watch.ready": "Ready to stream",
      "watch.titleSuffix": "Live stream | KoraZero",
      "watch.pressToPlayQ": "Press to play · quality",
      "watch.vs": "vs",
      "watch.server": "Server",
      "watch.vipServer": "VIP server",
      "watch.serverHd": "Server 1 · HD",
      "watch.serverSd": "Server 2 · SD",
      "watch.serverBackup": "Server 3 · backup",
      "watch.noMatches": "No matches available right now",
      "side.live": "Live",
      "side.upcoming": "Upcoming",
      "side.ended": "Ended",
      "side.commentary": "Commentary",
      "tz.ksa": "Saudi time",
      "tz.ksaShort": "Saudi",
      "tz.et": "US Eastern (ET)",
      "tz.etShort": "US East",
      "tz.dash": "—",
      "srv.checking": "🔎 Checking servers and finding the working ones…",
      "srv.okPrefix": "Highlighted",
      "srv.okSuffix": "available server(s) — the green one works",
      "srv.muteSuffix": "of them have no audio 🔇",
      "srv.down": "⚠️ Couldn't confirm any server right now — you can try manually",
      "srv.working": "Working",
      "srv.noAudio": "no audio",
      "srv.hasAudio": "audio ✓",
      "srv.unreachable": "This server is unreachable",
      "srv.checkingOne": "Checking server…",
    },
  };

  function getLang() {
    try {
      const q = new URLSearchParams(location.search).get("lang");
      if (q === "ar" || q === "en") { localStorage.setItem("kz-lang", q); return q; }
      const s = localStorage.getItem("kz-lang");
      if (s === "ar" || s === "en") return s;
    } catch (e) { /* ignore */ }
    return "ar";
  }

  let lang = getLang();

  function t(key, vars) {
    let s = (DICT[lang] && DICT[lang][key]);
    if (s == null) s = (DICT.ar[key] != null ? DICT.ar[key] : key);
    if (vars) Object.keys(vars).forEach((k) => { s = s.replace("{" + k + "}", vars[k]); });
    return s;
  }

  function applyDir() {
    const html = document.documentElement;
    html.setAttribute("lang", lang);
    html.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  }

  function applySeoMeta() {
    document.title = t("seo.title");
    const setMeta = (selector, content) => {
      const el = document.querySelector(selector);
      if (el && content) el.setAttribute("content", content);
    };
    setMeta('meta[name="description"]', t("seo.description"));
    setMeta('meta[property="og:title"]', t("seo.ogTitle"));
    setMeta('meta[property="og:description"]', t("seo.ogDescription"));
    setMeta('meta[name="twitter:title"]', t("seo.ogTitle"));
    setMeta('meta[name="twitter:description"]', t("seo.twitterDescription"));
  }

  function applyStatic(rootEl) {
    const scope = rootEl || document;
    scope.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n")); });
    scope.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.getAttribute("data-i18n-html")); });
    scope.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      el.getAttribute("data-i18n-attr").split(",").forEach((pair) => {
        const [attr, key] = pair.split(":").map((x) => x.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      });
    });
  }

  function set(next) {
    if (next !== "ar" && next !== "en") return;
    if (next === lang) return;
    try { localStorage.setItem("kz-lang", next); } catch (e) { /* ignore */ }
    location.reload();
  }

  function wireToggles() {
    document.querySelectorAll(".js-lang-toggle").forEach((btn) => {
      if (btn.__kzWired) return;
      btn.__kzWired = true;
      const full = btn.querySelector("[data-lang-label]");
      if (full) full.textContent = t("lang.toggleFull");
      else btn.textContent = t("lang.toggle");
      btn.setAttribute("aria-label", t("lang.toggleAria"));
      btn.addEventListener("click", (e) => { e.preventDefault(); set(lang === "ar" ? "en" : "ar"); });
    });
    if (global.KZTv && global.KZTv.syncTvToggles) global.KZTv.syncTvToggles();
  }

  applyDir(); // before paint — avoids a flash of the wrong direction
  document.addEventListener("DOMContentLoaded", () => { applySeoMeta(); applyStatic(); wireToggles(); });

  global.I18N = { t, applyStatic, applyDir, set, wireToggles, get lang() { return lang; } };
})(window);
