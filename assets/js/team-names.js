/* ============================================================================
 * team-names.js — English↔Arabic team-name map so Arabic queries match and
 * Arabic UI shows Arabic team names, even though the fixtures feed stores
 * English names.
 *
 * Exposes:
 *   window.TeamNames.localize(name)  -> Arabic name when I18N.lang === "ar"
 *                                       and a mapping exists, else the input.
 *   window.TeamNames.aliases(name)   -> [english, arabic, ...] for search.
 *
 * Coverage: FIFA national teams (World Cup 2026 pool) — extend freely.
 * ==========================================================================*/
(function (global) {
  "use strict";

  // English (canonical, as stored in the feed) -> Arabic.
  const EN_AR = {
    "Argentina": "الأرجنتين",
    "Brazil": "البرازيل",
    "France": "فرنسا",
    "Spain": "إسبانيا",
    "Portugal": "البرتغال",
    "England": "إنجلترا",
    "Belgium": "بلجيكا",
    "Netherlands": "هولندا",
    "Germany": "ألمانيا",
    "Italy": "إيطاليا",
    "Croatia": "كرواتيا",
    "Uruguay": "أوروغواي",
    "Colombia": "كولومبيا",
    "Mexico": "المكسيك",
    "United States": "الولايات المتحدة",
    "USA": "الولايات المتحدة",
    "Canada": "كندا",
    "Japan": "اليابان",
    "South Korea": "كوريا الجنوبية",
    "Korea Republic": "كوريا الجنوبية",
    "Australia": "أستراليا",
    "Saudi Arabia": "السعودية",
    "Iran": "إيران",
    "Iraq": "العراق",
    "Jordan": "الأردن",
    "Qatar": "قطر",
    "United Arab Emirates": "الإمارات",
    "UAE": "الإمارات",
    "Uzbekistan": "أوزبكستان",
    "Morocco": "المغرب",
    "Algeria": "الجزائر",
    "Tunisia": "تونس",
    "Egypt": "مصر",
    "Senegal": "السنغال",
    "Ghana": "غانا",
    "Nigeria": "نيجيريا",
    "Cameroon": "الكاميرون",
    "Ivory Coast": "ساحل العاج",
    "Cote d'Ivoire": "ساحل العاج",
    "Cape Verde": "الرأس الأخضر",
    "Congo DR": "الكونغو الديمقراطية",
    "DR Congo": "الكونغو الديمقراطية",
    "South Africa": "جنوب أفريقيا",
    "New Zealand": "نيوزيلندا",
    "Panama": "بنما",
    "Costa Rica": "كوستاريكا",
    "Ecuador": "الإكوادور",
    "Paraguay": "باراغواي",
    "Peru": "بيرو",
    "Chile": "تشيلي",
    "Norway": "النرويج",
    "Austria": "النمسا",
    "Switzerland": "سويسرا",
    "Denmark": "الدنمارك",
    "Sweden": "السويد",
    "Poland": "بولندا",
    "Serbia": "صربيا",
    "Turkey": "تركيا",
    "Türkiye": "تركيا",
    "Scotland": "اسكتلندا",
    "Wales": "ويلز",
    "Ukraine": "أوكرانيا",
    "Greece": "اليونان",
    "Czechia": "التشيك",
    "Czech Republic": "التشيك",
  };

  const norm = (s) => (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();

  // Build a normalized lookup so "south korea", "South-Korea" etc. all resolve.
  const NORM_AR = {};
  Object.keys(EN_AR).forEach((en) => { NORM_AR[norm(en)] = EN_AR[en]; });

  function arabicFor(name) {
    return NORM_AR[norm(name)] || null;
  }

  function localize(name) {
    const lang = global.I18N && global.I18N.lang;
    if (lang === "ar") return arabicFor(name) || name;
    return name;
  }

  function aliases(name) {
    const out = [name];
    const ar = arabicFor(name);
    if (ar) out.push(ar);
    return out;
  }

  global.TeamNames = { localize, aliases, arabicFor };
})(typeof window !== "undefined" ? window : this);
