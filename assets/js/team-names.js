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
 * Coverage: FIFA national teams plus the active Premier League, La Liga,
 * Saudi Pro League, and Champions League clubs shown by the 2026/27 schedule.
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
    "Bosnia-Herzegovina": "البوسنة والهرسك",
    "Curaçao": "كوراساو",
    "Curacao": "كوراساو",
    "Haiti": "هايتي",
    "AFC Bournemouth": "بورنموث",
    "Arsenal": "أرسنال",
    "Aston Villa": "أستون فيلا",
    "Brentford": "برينتفورد",
    "Brighton & Hove Albion": "برايتون",
    "Chelsea": "تشيلسي",
    "Coventry City": "كوفنتري سيتي",
    "Crystal Palace": "كريستال بالاس",
    "Everton": "إيفرتون",
    "Fulham": "فولهام",
    "Hull City": "هال سيتي",
    "Ipswich Town": "إيبسويتش تاون",
    "Leeds United": "ليدز يونايتد",
    "Liverpool": "ليفربول",
    "Manchester City": "مانشستر سيتي",
    "Manchester United": "مانشستر يونايتد",
    "Newcastle United": "نيوكاسل يونايتد",
    "Nottingham Forest": "نوتنغهام فورست",
    "Sunderland": "سندرلاند",
    "Tottenham Hotspur": "توتنهام هوتسبير",
    "Alavés": "ألافيس",
    "Athletic Club": "أتلتيك بيلباو",
    "Atlético Madrid": "أتلتيكو مدريد",
    "Barcelona": "برشلونة",
    "Celta Vigo": "سيلتا فيغو",
    "Deportivo": "ديبورتيفو لا كورونيا",
    "Elche": "إلتشي",
    "Espanyol": "إسبانيول",
    "Getafe": "خيتافي",
    "Levante": "ليفانتي",
    "Málaga": "مالقة",
    "Osasuna": "أوساسونا",
    "Racing Santander": "راسينغ سانتاندير",
    "Rayo Vallecano": "رايو فاييكانو",
    "Real Betis": "ريال بيتيس",
    "Real Madrid": "ريال مدريد",
    "Real Sociedad": "ريال سوسيداد",
    "Sevilla": "إشبيلية",
    "Valencia": "فالنسيا",
    "Villarreal": "فياريال",
    "AEK Athens": "آيك أثينا",
    "Bodo/Glimt": "بودو غليمت",
    "Celtic": "سلتيك",
    "Dinamo Zagreb": "دينامو زغرب",
    "Fenerbahce": "فنربخشة",
    "Hapoel Be'er": "هابوعيل بئر السبع",
    "LASK Linz": "لاسك لينتس",
    "Levski Sofia": "ليفسكي صوفيا",
    "Lyon": "ليون",
    "NEC Nijmegen": "إن إي سي نيميغن",
    "NK Celje": "تسيله",
    "Sabah FK": "صباح",
    "Slovan Bratislava": "سلوفان براتيسلافا",
    "Viking FK": "فايكينغ",
    "Paris Saint-Germain": "باريس سان جيرمان",
    "Bayern Munich": "بايرن ميونخ",
    "Borussia Dortmund": "بوروسيا دورتموند",
    "Inter Milan": "إنتر ميلان",
    "AC Milan": "ميلان",
    "Juventus": "يوفنتوس",
    "Napoli": "نابولي",
    "Atalanta": "أتالانتا",
    "Marseille": "مارسيليا",
    "Monaco": "موناكو",
    "Benfica": "بنفيكا",
    "Sporting CP": "سبورتينغ لشبونة",
    "FC Porto": "بورتو",
    "Ajax Amsterdam": "أياكس",
    "PSV Eindhoven": "آيندهوفن",
    "Galatasaray": "غلطة سراي",
    "Club Brugge": "كلوب بروج",
    "Al Ahli": "الأهلي",
    "Al Diriyah": "الدرعية",
    "Al Ettifaq": "الاتفاق",
    "Al Fateh": "الفتح",
    "Al-Faisaly": "الفيصلي",
    "Al Faisaly": "الفيصلي",
    "Al Fayha": "الفيحاء",
    "Al Hazem": "الحزم",
    "Al Hilal": "الهلال",
    "Al Ittihad": "الاتحاد",
    "Al Khaleej": "الخليج",
    "Al Kholood": "الخلود",
    "Al Najma": "النجمة",
    "Al Nassr": "النصر",
    "Al Okhdood": "الأخدود",
    "Al Qadsiah": "القادسية",
    "Al Riyadh": "الرياض",
    "Al Shabab": "الشباب",
    "Al Taawoun": "التعاون",
    "Al Wehda": "الوحدة",
    "Damac": "ضمك",
    "NEOM": "نيوم",
    "Neom": "نيوم",
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

  // Canonical identity token for a team name. Anchored on the Arabic name because
  // the alias table collapses every English variant of a team to one Arabic
  // string ("USA" and "United States" both -> "الولايات المتحدة"), so variant
  // English feeds and Arabic-sourced clips resolve to the SAME token. Unknown
  // teams fall back to their normalized English name (identity — no regression).
  // Accepts a raw name OR an already-normalized token (arabicFor normalizes).
  function canonicalToken(name) {
    return arabicFor(name) || norm(name);
  }

  // Stable pair key for matching a fixture to its memes/highlights/clips.
  function canonicalKey(home, away) {
    return [canonicalToken(home), canonicalToken(away)].sort().join("~");
  }

  // Re-key a stored "home~away" key through the canonical tokens, so a key built
  // from one name variant still matches a lookup built from another.
  function canonicalizeKey(rawKey) {
    return String(rawKey || "")
      .split("~")
      .map(canonicalToken)
      .sort()
      .join("~");
  }

  function slugFor(name) {
    return String(name || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/['']/g, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  }

  function teamFromSlug(slug, candidates) {
    const want = String(slug || "").toLowerCase().trim();
    if (!want) return null;
    for (const name of candidates || []) {
      if (slugFor(name) === want) return name;
    }
    return null;
  }

  function matchSlug(home, away) {
    const slugs = [slugFor(home), slugFor(away)].filter(Boolean).sort();
    if (slugs.length !== 2) return "";
    return `${slugs[0]}-vs-${slugs[1]}`;
  }

  function matchPageHref(m) {
    if (!m?.home || !m?.away) return "";
    const worldCup = m.leagueSlug === "fifa.world" || /^espn-fifa\.world-/.test(m.id || "");
    if (!worldCup) return "";
    const slug = matchSlug(m.home, m.away);
    return slug ? `/world-cup-2026/${slug}` : "";
  }

  global.TeamNames = {
    localize,
    aliases,
    arabicFor,
    canonicalToken,
    canonicalKey,
    canonicalizeKey,
    slugFor,
    teamFromSlug,
    matchSlug,
    matchPageHref,
  };
})(typeof window !== "undefined" ? window : this);
