/* ============================================================================
 * team-names.js — English↔Arabic team-name map so Arabic queries match and
 * Arabic UI shows Arabic team names, even though the fixtures feed stores
 * English names.
 *
 * Exposes:
 *   window.TeamNames.localize(name)  -> Arabic name when I18N.lang === "ar"
 *                                       and a mapping exists, else the input.
 *   window.TeamNames.aliases(name)   -> [english, aliases, arabic] for search.
 *   window.TeamNames.resolveNationalTeam(name) -> canonical audience metadata.
 * ==========================================================================*/
(function (global) {
  "use strict";

  // English feed names -> Arabic display names. Aliases can also be listed here
  // when a provider has historically used more than one spelling.
  const EN_AR = {
    Argentina: "الأرجنتين",
    Brazil: "البرازيل",
    France: "فرنسا",
    Spain: "إسبانيا",
    Portugal: "البرتغال",
    England: "إنجلترا",
    Belgium: "بلجيكا",
    Netherlands: "هولندا",
    Germany: "ألمانيا",
    Italy: "إيطاليا",
    Croatia: "كرواتيا",
    Uruguay: "أوروغواي",
    Colombia: "كولومبيا",
    Mexico: "المكسيك",
    "United States": "الولايات المتحدة",
    USA: "الولايات المتحدة",
    Canada: "كندا",
    Japan: "اليابان",
    "South Korea": "كوريا الجنوبية",
    "Korea Republic": "كوريا الجنوبية",
    Australia: "أستراليا",
    "Saudi Arabia": "السعودية",
    Iran: "إيران",
    Iraq: "العراق",
    Jordan: "الأردن",
    Qatar: "قطر",
    "United Arab Emirates": "الإمارات",
    UAE: "الإمارات",
    Kuwait: "الكويت",
    Bahrain: "البحرين",
    Oman: "عُمان",
    Uzbekistan: "أوزبكستان",
    Morocco: "المغرب",
    Algeria: "الجزائر",
    Tunisia: "تونس",
    Egypt: "مصر",
    Libya: "ليبيا",
    Senegal: "السنغال",
    Ghana: "غانا",
    Nigeria: "نيجيريا",
    Cameroon: "الكاميرون",
    "Ivory Coast": "ساحل العاج",
    "Cote d'Ivoire": "ساحل العاج",
    "Cape Verde": "الرأس الأخضر",
    "Congo DR": "الكونغو الديمقراطية",
    "DR Congo": "الكونغو الديمقراطية",
    "South Africa": "جنوب أفريقيا",
    "New Zealand": "نيوزيلندا",
    Panama: "بنما",
    "Costa Rica": "كوستاريكا",
    Ecuador: "الإكوادور",
    Paraguay: "باراغواي",
    Peru: "بيرو",
    Chile: "تشيلي",
    Norway: "النرويج",
    Austria: "النمسا",
    Switzerland: "سويسرا",
    Denmark: "الدنمارك",
    Sweden: "السويد",
    Poland: "بولندا",
    Serbia: "صربيا",
    Turkey: "تركيا",
    Türkiye: "تركيا",
    Scotland: "اسكتلندا",
    Wales: "ويلز",
    Ukraine: "أوكرانيا",
    Greece: "اليونان",
    Czechia: "التشيك",
    "Czech Republic": "التشيك",
    "Bosnia-Herzegovina": "البوسنة والهرسك",
    "Bosnia and Herzegovina": "البوسنة والهرسك",
    Albania: "ألبانيا",
    Andorra: "أندورا",
    Armenia: "أرمينيا",
    Azerbaijan: "أذربيجان",
    Belarus: "بيلاروسيا",
    Bulgaria: "بلغاريا",
    Cyprus: "قبرص",
    Estonia: "إستونيا",
    "Faroe Islands": "جزر فارو",
    Finland: "فنلندا",
    Georgia: "جورجيا",
    Gibraltar: "جبل طارق",
    Hungary: "المجر",
    Iceland: "آيسلندا",
    Israel: "إسرائيل",
    Kazakhstan: "كازاخستان",
    Kosovo: "كوسوفو",
    Latvia: "لاتفيا",
    Liechtenstein: "ليختنشتاين",
    Lithuania: "ليتوانيا",
    Luxembourg: "لوكسمبورغ",
    Malta: "مالطا",
    Moldova: "مولدوفا",
    Montenegro: "الجبل الأسود",
    "North Macedonia": "مقدونيا الشمالية",
    "Northern Ireland": "أيرلندا الشمالية",
    "Republic of Ireland": "جمهورية أيرلندا",
    Ireland: "جمهورية أيرلندا",
    Romania: "رومانيا",
    Russia: "روسيا",
    "San Marino": "سان مارينو",
    Slovakia: "سلوفاكيا",
    Slovenia: "سلوفينيا",
    Curaçao: "كوراساو",
    Curacao: "كوراساو",
    Haiti: "هايتي",
    "AFC Bournemouth": "بورنموث",
    Arsenal: "أرسنال",
    "Aston Villa": "أستون فيلا",
    Brentford: "برينتفورد",
    "Brighton & Hove Albion": "برايتون",
    Chelsea: "تشيلسي",
    "Coventry City": "كوفنتري سيتي",
    "Crystal Palace": "كريستال بالاس",
    Everton: "إيفرتون",
    Fulham: "فولهام",
    "Hull City": "هال سيتي",
    "Ipswich Town": "إيبسويتش تاون",
    "Leeds United": "ليدز يونايتد",
    Liverpool: "ليفربول",
    "Manchester City": "مانشستر سيتي",
    "Manchester United": "مانشستر يونايتد",
    "Newcastle United": "نيوكاسل يونايتد",
    "Nottingham Forest": "نوتنغهام فورست",
    Sunderland: "سندرلاند",
    "Tottenham Hotspur": "توتنهام هوتسبير",
    Alavés: "ألافيس",
    "Athletic Club": "أتلتيك بيلباو",
    "Atlético Madrid": "أتلتيكو مدريد",
    Barcelona: "برشلونة",
    "Celta Vigo": "سيلتا فيغو",
    Deportivo: "ديبورتيفو لا كورونيا",
    Elche: "إلتشي",
    Espanyol: "إسبانيول",
    Getafe: "خيتافي",
    Levante: "ليفانتي",
    Málaga: "مالقة",
    Osasuna: "أوساسونا",
    "Racing Santander": "راسينغ سانتاندير",
    "Rayo Vallecano": "رايو فاييكانو",
    "Real Betis": "ريال بيتيس",
    "Real Madrid": "ريال مدريد",
    "Real Sociedad": "ريال سوسيداد",
    Sevilla: "إشبيلية",
    Valencia: "فالنسيا",
    Villarreal: "فياريال",
    "AEK Athens": "آيك أثينا",
    "Bodo/Glimt": "بودو غليمت",
    Celtic: "سلتيك",
    "Dinamo Zagreb": "دينامو زغرب",
    Fenerbahce: "فنربخشة",
    "Hapoel Be'er": "هابوعيل بئر السبع",
    "LASK Linz": "لاسك لينتس",
    "Levski Sofia": "ليفسكي صوفيا",
    Lyon: "ليون",
    "NEC Nijmegen": "إن إي سي نيميغن",
    "NK Celje": "تسيله",
    "Sabah FK": "صباح",
    "Slovan Bratislava": "سلوفان براتيسلافا",
    "Viking FK": "فايكينغ",
    Angers: "أنجيه",
    "Angers SCO": "أنجيه",
    "AJ Auxerre": "أوكسير",
    Auxerre: "أوكسير",
    Brest: "بريست",
    "Stade Brestois 29": "بريست",
    "Le Havre": "لوهافر",
    "Le Havre AC": "لوهافر",
    Lens: "لانس",
    "RC Lens": "لانس",
    Lille: "ليل",
    "LOSC Lille": "ليل",
    Lorient: "لوريان",
    "FC Lorient": "لوريان",
    "Le Mans": "لو مان",
    "Le Mans FC": "لو مان",
    Nice: "نيس",
    "OGC Nice": "نيس",
    "Paris FC": "باريس إف سي",
    Rennes: "رين",
    "Stade Rennes": "رين",
    Strasbourg: "ستراسبورغ",
    "RC Strasbourg": "ستراسبورغ",
    Toulouse: "تولوز",
    "Toulouse FC": "تولوز",
    Troyes: "تروا",
    "ESTAC Troyes": "تروا",
    "Paris Saint-Germain": "باريس سان جيرمان",
    "Bayern Munich": "بايرن ميونخ",
    "Borussia Dortmund": "بوروسيا دورتموند",
    "Inter Milan": "إنتر ميلان",
    "AC Milan": "ميلان",
    Juventus: "يوفنتوس",
    Napoli: "نابولي",
    Atalanta: "أتالانتا",
    Marseille: "مارسيليا",
    Monaco: "موناكو",
    Benfica: "بنفيكا",
    "Sporting CP": "سبورتينغ لشبونة",
    "FC Porto": "بورتو",
    "Ajax Amsterdam": "أياكس",
    "PSV Eindhoven": "آيندهوفن",
    Galatasaray: "غلطة سراي",
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
    Damac: "ضمك",
    NEOM: "نيوم",
    Neom: "نيوم",
  };

  // Audience policy is data, not match logic. A canonical country can expose
  // feed aliases without forcing the rest of the app to care which spelling
  // ESPN/TheSportsDB used on a particular day.
  const NATIONAL_TEAM_REGISTRY = Object.freeze([
    { name: "Egypt", ar: "مصر", aliases: [], groups: ["north_africa"] },
    { name: "Morocco", ar: "المغرب", aliases: [], groups: ["north_africa"] },
    { name: "Algeria", ar: "الجزائر", aliases: [], groups: ["north_africa"] },
    { name: "Tunisia", ar: "تونس", aliases: [], groups: ["north_africa"] },
    { name: "Libya", ar: "ليبيا", aliases: [], groups: ["north_africa"] },
    { name: "Saudi Arabia", ar: "السعودية", aliases: ["Saudi", "KSA"], groups: ["gcc"] },
    {
      name: "United Arab Emirates",
      ar: "الإمارات",
      aliases: ["UAE", "U.A.E."],
      groups: ["gcc"],
    },
    { name: "Qatar", ar: "قطر", aliases: [], groups: ["gcc"] },
    { name: "Kuwait", ar: "الكويت", aliases: [], groups: ["gcc"] },
    { name: "Bahrain", ar: "البحرين", aliases: [], groups: ["gcc"] },
    { name: "Oman", ar: "عُمان", aliases: [], groups: ["gcc"] },
    { name: "Brazil", ar: "البرازيل", aliases: ["Brasil"], groups: ["priority_latam"] },
    { name: "Argentina", ar: "الأرجنتين", aliases: [], groups: ["priority_latam"] },
  ]);

  const norm = (s) => (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();

  const NORM_AR = {};
  Object.keys(EN_AR).forEach((en) => {
    NORM_AR[norm(en)] = EN_AR[en];
  });

  const NATIONAL_BY_ALIAS = {};
  for (const team of NATIONAL_TEAM_REGISTRY) {
    for (const label of [team.name, ...(team.aliases || [])]) {
      NATIONAL_BY_ALIAS[norm(label)] = team;
      NORM_AR[norm(label)] = team.ar;
    }
  }

  function resolveNationalTeam(name) {
    return NATIONAL_BY_ALIAS[norm(name)] || null;
  }

  function isInAudienceGroup(name, group) {
    const team = resolveNationalTeam(name);
    return !!team && team.groups.includes(group);
  }

  function buildRegionArabicLookup() {
    if (typeof Intl === "undefined" || typeof Intl.DisplayNames !== "function") return {};
    const english = new Intl.DisplayNames(["en"], { type: "region" });
    const arabic = new Intl.DisplayNames(["ar"], { type: "region" });
    const lookup = {};
    for (let first = 65; first <= 90; first++) {
      for (let second = 65; second <= 90; second++) {
        const code = String.fromCharCode(first, second);
        const en = english.of(code);
        const ar = arabic.of(code);
        if (!en || !ar || en === code || ar === code || en === "Unknown Region") continue;
        lookup[norm(en)] = ar;
      }
    }
    return lookup;
  }

  const REGION_AR = buildRegionArabicLookup();

  function arabicFor(name) {
    const key = norm(name);
    return NORM_AR[key] || REGION_AR[key] || null;
  }

  function localize(name) {
    const lang = global.I18N && global.I18N.lang;
    if (lang === "ar") return arabicFor(name) || name;
    return name;
  }

  function aliases(name) {
    const team = resolveNationalTeam(name);
    if (team) return [...new Set([team.name, ...(team.aliases || []), team.ar])];
    const out = [name];
    const ar = arabicFor(name);
    if (ar) out.push(ar);
    return out;
  }

  function canonicalToken(name) {
    const team = resolveNationalTeam(name);
    if (team) return team.ar;
    return arabicFor(name) || norm(name);
  }

  function canonicalKey(home, away) {
    return [canonicalToken(home), canonicalToken(away)].sort().join("~");
  }

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
    resolveNationalTeam,
    isInAudienceGroup,
    canonicalToken,
    canonicalKey,
    canonicalizeKey,
    slugFor,
    teamFromSlug,
    matchSlug,
    matchPageHref,
  };
})(typeof window !== "undefined" ? window : this);