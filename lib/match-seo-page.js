const LEAGUE_ROUTES = Object.freeze({
  epl: "/league/premier-league",
  laliga: "/league/la-liga",
  spl: "/league/saudi-pro-league",
  ucl: "/league/champions-league",
});

const LEAGUE_EN = Object.freeze({
  epl: "Premier League",
  laliga: "La Liga",
  spl: "Saudi Pro League",
  ucl: "UEFA Champions League",
});

const ZONES = Object.freeze([
  { ar: "مكة المكرمة (السعودية)", en: "Makkah (Saudi Arabia)", zone: "Asia/Riyadh" },
  { ar: "الإمارات", en: "UAE", zone: "Asia/Dubai" },
  { ar: "مصر", en: "Egypt", zone: "Africa/Cairo" },
  { ar: "المملكة المتحدة", en: "United Kingdom", zone: "Europe/London" },
]);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function arTeam(name, teamNamesAr) {
  return teamNamesAr?.[name] || name || "";
}

function leagueName(match, lang) {
  if (lang === "ar") return match?.leagueAr || match?.league || "كرة القدم";
  return LEAGUE_EN[match?.competition] || match?.league || "Football";
}

function leagueRoute(match) {
  return LEAGUE_ROUTES[match?.competition] || "/matches";
}

function statusLabel(match, lang) {
  if (match?.seoEventStatus === "EventPostponed") return lang === "ar" ? "تأجلت" : "Postponed";
  if (match?.seoEventStatus === "EventCancelled") return lang === "ar" ? "أُلغيت" : "Cancelled";
  if (match?.seoEventStatus === "EventRescheduled") return lang === "ar" ? "أعيدت جدولة المباراة" : "Rescheduled";
  if (match?.status === "live") return lang === "ar" ? "مباشر" : "Live";
  if (match?.status === "ended") return lang === "ar" ? "انتهت" : "Full time";
  return lang === "ar" ? "لم تبدأ" : "Scheduled";
}

function formatKickoff(iso, timeZone, lang) {
  const ms = Date.parse(iso || "");
  if (Number.isNaN(ms)) return "";
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(ms));
}

export function isoWithZone(iso, timeZone = "UTC") {
  const ms = Date.parse(iso || "");
  if (Number.isNaN(ms)) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(new Date(ms));
  const part = (type) => parts.find((row) => row.type === type)?.value || "";
  const rawOffset = part("timeZoneName").replace("GMT", "") || "+00:00";
  const offset = /^[+-]\d{2}:\d{2}$/.test(rawOffset) ? rawOffset : "+00:00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}${offset}`;
}

function timeSection(match, lang) {
  if (!match?.kickoffUtc) return "";
  const rows = ZONES.map((item) => {
    const text = formatKickoff(match.kickoffUtc, item.zone, lang);
    const datetime = isoWithZone(match.kickoffUtc, item.zone);
    return text
      ? `<li><strong>${escapeHtml(lang === "ar" ? item.ar : item.en)}:</strong> <time datetime="${escapeHtml(datetime)}">${escapeHtml(text)}</time></li>`
      : "";
  }).filter(Boolean);
  return rows.length
    ? `<section class="seo-section"><div class="seo-section-head"><h2>${lang === "ar" ? "موعد المباراة" : "Kickoff times"}</h2></div><ul class="seo-detail">${rows.join("")}</ul></section>`
    : "";
}

function overviewSection(match, lang) {
  const venue = match?.venueInfo;
  const rows = [
    `<p><strong>${lang === "ar" ? "البطولة" : "Competition"}:</strong> ${escapeHtml(leagueName(match, lang))}</p>`,
    match?.matchday ? `<p><strong>${lang === "ar" ? "الجولة" : "Matchday"}:</strong> ${escapeHtml(match.matchday)}</p>` : "",
    venue?.name ? `<p><strong>${lang === "ar" ? "الملعب" : "Stadium"}:</strong> ${escapeHtml(venue.name)}</p>` : "",
    venue?.city ? `<p><strong>${lang === "ar" ? "المدينة" : "City"}:</strong> ${escapeHtml(venue.city)}</p>` : "",
    venue?.country ? `<p><strong>${lang === "ar" ? "الدولة" : "Country"}:</strong> ${escapeHtml(venue.country)}</p>` : "",
    `<p><strong>${lang === "ar" ? "الحالة" : "Status"}:</strong> ${escapeHtml(statusLabel(match, lang))}</p>`,
  ].filter(Boolean);
  return `<section class="seo-section"><div class="seo-section-head"><h2>${lang === "ar" ? "تفاصيل المباراة" : "Match details"}</h2></div><div class="seo-card seo-detail">${rows.join("")}</div></section>`;
}

function h2hSection(match, lang, teamNamesAr) {
  const row = match?.headToHead;
  if (!row) return "";
  let summary = String(row.summary || "").trim();
  if (lang === "ar" && summary) {
    const lead = /^([A-Z0-9]+) leads series ([0-9-]+)$/i.exec(summary);
    if (lead) {
      const abbr = lead[1].toUpperCase();
      const team =
        abbr === String(match.homeAbbr || "").toUpperCase()
          ? arTeam(match.home, teamNamesAr)
          : abbr === String(match.awayAbbr || "").toUpperCase()
            ? arTeam(match.away, teamNamesAr)
            : abbr;
      // ESPN supplies the compact series string, but not a labelled W-D-L tuple here.
      // Preserve it verbatim instead of guessing what each number means.
      summary = `${team} يتقدم في سجل المواجهات ${lead[2]}`;
    } else if (/^series tied/i.test(summary)) {
      summary = `سجل المواجهات متعادل${row.seriesScore ? `: ${row.seriesScore}` : ""}`;
    }
  }
  const body = [
    summary ? `<p>${escapeHtml(summary)}</p>` : "",
    row.totalCompetitions
      ? `<p><strong>${lang === "ar" ? "عدد المواجهات في السجل" : "Matches in record"}:</strong> ${row.totalCompetitions}</p>`
      : "",
  ]
    .filter(Boolean)
    .join("");
  return body
    ? `<section class="seo-section"><div class="seo-section-head"><h2>${lang === "ar" ? "المواجهات المباشرة" : "Head-to-head"}</h2></div><div class="seo-card">${body}</div></section>`
    : "";
}

function resultWord(code, lang) {
  const map = lang === "ar" ? { W: "فوز", D: "تعادل", L: "خسارة" } : { W: "Win", D: "Draw", L: "Loss" };
  return map[String(code || "").toUpperCase()] || String(code || "");
}

function recentFormSection(match, lang, teamNamesAr) {
  const form = match?.recentForm;
  if (!form || (!form.home?.length && !form.away?.length)) return "";
  const render = (name, rows, record) => {
    if (!rows?.length && !record) return "";
    const recordHtml = record
      ? `<p><strong>${lang === "ar" ? "سجل البطولة" : "Competition record"}:</strong> ${escapeHtml(record)}</p>`
      : "";
    const list = (rows || [])
      .map((row) => {
        const opponent = lang === "ar" ? arTeam(row.opponent, teamNamesAr) : row.opponent;
        return `<li><strong>${escapeHtml(resultWord(row.result, lang))}</strong> · ${escapeHtml(opponent)}${row.score ? ` · ${escapeHtml(row.score)}` : ""}</li>`;
      })
      .join("");
    return `<div class="seo-card"><h3>${escapeHtml(name)}</h3>${recordHtml}${list ? `<ul class="seo-detail">${list}</ul>` : ""}</div>`;
  };
  const home = lang === "ar" ? arTeam(match.home, teamNamesAr) : match.home;
  const away = lang === "ar" ? arTeam(match.away, teamNamesAr) : match.away;
  const cards = [render(home, form.home, match.homeRecord), render(away, form.away, match.awayRecord)].filter(Boolean);
  return cards.length
    ? `<section class="seo-section"><div class="seo-section-head"><h2>${lang === "ar" ? "آخر المباريات" : "Recent form"}</h2></div><div class="seo-grid">${cards.join("")}</div></section>`
    : "";
}

function lineupsSection(match, lang, teamNamesAr) {
  const homeRows = match?.lineups?.home?.starters || [];
  const awayRows = match?.lineups?.away?.starters || [];
  if (homeRows.length < 11 || awayRows.length < 11) return "";
  const render = (name, side) => `<div class="seo-card"><h3>${escapeHtml(name)}</h3>${side.formation ? `<p><strong>${lang === "ar" ? "الخطة" : "Formation"}:</strong> ${escapeHtml(side.formation)}</p>` : ""}<ol class="seo-detail">${side.starters.map((player) => `<li>${escapeHtml(player.name)}</li>`).join("")}</ol></div>`;
  const home = lang === "ar" ? arTeam(match.home, teamNamesAr) : match.home;
  const away = lang === "ar" ? arTeam(match.away, teamNamesAr) : match.away;
  return `<section class="seo-section"><div class="seo-section-head"><h2>${lang === "ar" ? "التشكيل الرسمي" : "Official lineups"}</h2></div><div class="seo-grid">${render(home, match.lineups.home)}${render(away, match.lineups.away)}</div></section>`;
}

function regionName(region, lang) {
  const map = {
    us: { ar: "الولايات المتحدة", en: "United States" },
    gb: { ar: "المملكة المتحدة", en: "United Kingdom" },
    uk: { ar: "المملكة المتحدة", en: "United Kingdom" },
    sa: { ar: "السعودية", en: "Saudi Arabia" },
    ae: { ar: "الإمارات", en: "UAE" },
    eg: { ar: "مصر", en: "Egypt" },
  };
  const code = String(region || "").toLowerCase();
  return map[code]?.[lang] || String(region || "").toUpperCase();
}

function broadcastersSection(match, lang) {
  const rows = match?.broadcasters || [];
  if (!rows.length) return "";
  return `<section class="seo-section"><div class="seo-section-head"><h2>${lang === "ar" ? "حقوق البث حسب السوق" : "Broadcast rights by market"}</h2></div><ul class="seo-detail">${rows
    .map((row) => `<li><strong>${escapeHtml(regionName(row.region, lang) || (lang === "ar" ? "السوق المعلن" : "Listed market"))}:</strong> ${escapeHtml(row.name)}${row.type ? ` · ${escapeHtml(row.type)}` : ""}</li>`)
    .join("")}</ul></section>`;
}

function coverageSection(match, lang) {
  const rows = [
    match?.channel ? `<p><strong>${lang === "ar" ? "القناة" : "Channel"}:</strong> ${escapeHtml(match.channel)}</p>` : "",
    match?.commentator ? `<p><strong>${lang === "ar" ? "المعلّق" : "Commentator"}:</strong> ${escapeHtml(match.commentator)}</p>` : "",
  ].filter(Boolean);
  return rows.length
    ? `<section class="seo-section"><div class="seo-section-head"><h2>${lang === "ar" ? "معلومات التغطية" : "Coverage information"}</h2></div><div class="seo-card">${rows.join("")}</div></section>`
    : "";
}

function goalsHtml(match, lang) {
  const goals = match?.goals || [];
  if (!goals.length) return "";
  return `<div class="seo-card"><h3>${lang === "ar" ? "الأهداف" : "Goals"}</h3><ul class="seo-detail">${goals
    .map((goal) => {
      const flags = [goal.penalty ? (lang === "ar" ? "ركلة جزاء" : "penalty") : "", goal.own ? (lang === "ar" ? "هدف عكسي" : "own goal") : ""]
        .filter(Boolean)
        .join(" · ");
      return `<li>${escapeHtml(goal.scorer || (lang === "ar" ? "مسجل الهدف" : "Scorer"))}${goal.minute ? ` · ${escapeHtml(goal.minute)}` : ""}${flags ? ` · ${escapeHtml(flags)}` : ""}</li>`;
    })
    .join("")}</ul></div>`;
}

function highlightRows(match) {
  const candidates = [match?.highlights?.goals, match?.highlights?.full, match?.highlight, ...(match?.clips || [])].filter(
    (row) => row?.videoUrl,
  );
  const seen = new Set();
  return candidates.filter((row) => {
    if (seen.has(row.videoUrl)) return false;
    seen.add(row.videoUrl);
    return true;
  });
}

function highlightsHtml(match, lang) {
  const rows = highlightRows(match);
  if (!rows.length) return "";
  return `<div class="seo-card"><h3>${lang === "ar" ? "الملخص والأهداف" : "Highlights"}</h3><ul class="seo-detail">${rows
    .map((row) => `<li><a href="${escapeHtml(row.videoUrl)}">${escapeHtml(row.title || (lang === "ar" ? "مشاهدة الملخص" : "Watch highlights"))}</a></li>`)
    .join("")}</ul></div>`;
}

function resultSection(match, lang) {
  if (match?.status !== "live" && match?.status !== "ended") return "";
  const title = match.status === "ended" ? (lang === "ar" ? "النتيجة النهائية" : "Final score") : lang === "ar" ? "النتيجة المباشرة" : "Live score";
  const score = match?.score && match.score !== "VS" ? `<p class="seo-score">${escapeHtml(match.score)}</p>` : "";
  return `<section class="seo-section seo-result"><div class="seo-section-head"><h2>${title}</h2></div>${score}${goalsHtml(match, lang)}${match.status === "ended" ? highlightsHtml(match, lang) : ""}</section>`;
}

function socialImage(match, siteUrl) {
  return (
    match?.highlights?.full?.thumbnail ||
    match?.highlights?.goals?.thumbnail ||
    match?.highlight?.thumbnail ||
    match?.clips?.find((row) => row?.thumbnail)?.thumbnail ||
    `${siteUrl}/assets/img/korazero-showdown.jpg`
  );
}

function eventSpecificImage(match) {
  return (
    match?.highlights?.full?.thumbnail ||
    match?.highlights?.goals?.thumbnail ||
    match?.highlight?.thumbnail ||
    match?.clips?.find((row) => row?.thumbnail)?.thumbnail ||
    ""
  );
}

function teamSchema(info, arName, enName) {
  const node = { "@type": "SportsTeam", name: arName || enName || "" };
  if (enName && enName !== arName) node.alternateName = enName;
  if (info?.url) {
    node["@id"] = info.url;
    node.url = info.url;
  }
  return node;
}

function locationSchema(match) {
  const venue = match?.venueInfo;
  // Google Event requires a detailed PostalAddress. The sampled ESPN feed usually
  // supplies stadium/city/country but not streetAddress, so omit schema location
  // rather than manufacture an address. Visible stadium text is still rendered.
  if (!venue?.name || !venue?.streetAddress || !venue?.city || !venue?.country) return null;
  return {
    "@type": "Place",
    name: venue.name,
    address: {
      "@type": "PostalAddress",
      streetAddress: venue.streetAddress,
      addressLocality: venue.city,
      addressCountry: venue.country,
    },
  };
}

function buildSchema({ match, route, siteUrl, teamNamesAr, lang }) {
  const homeAr = arTeam(match.home, teamNamesAr);
  const awayAr = arTeam(match.away, teamNamesAr);
  const home = lang === "ar" ? homeAr : match.home;
  const away = lang === "ar" ? awayAr : match.away;
  const competition = leagueName(match, lang);
  const event = {
    "@type": "SportsEvent",
    "@id": `${siteUrl}${route}#event`,
    name: `${home} ${lang === "ar" ? "ضد" : "vs"} ${away}`,
    url: `${siteUrl}${route}`,
    startDate: isoWithZone(match.kickoffUtc, "UTC"),
    eventStatus: `https://schema.org/${match?.seoEventStatus || "EventScheduled"}`,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    sport: "Football",
    description:
      lang === "ar"
        ? `مباراة ${home} ضد ${away} ضمن ${competition}.`
        : `${home} vs ${away} in ${competition}.`,
    homeTeam: teamSchema(match.homeTeamInfo, homeAr, match.home),
    awayTeam: teamSchema(match.awayTeamInfo, awayAr, match.away),
  };
  const location = locationSchema(match);
  if (location) event.location = location;
  // Do not invent 16:9/4:3/1:1 variants. Only attach an event image when the feed
  // has a real match-specific image; otherwise omit the Event.image property.
  const image = eventSpecificImage(match);
  if (image) event.image = [image];

  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: lang === "ar" ? "الرئيسية" : "Home", item: `${siteUrl}/` },
      { "@type": "ListItem", position: 2, name: competition, item: `${siteUrl}${leagueRoute(match)}` },
      { "@type": "ListItem", position: 3, name: `${home} ${lang === "ar" ? "ضد" : "vs"} ${away}`, item: `${siteUrl}${route}` },
    ],
  };
  return { "@context": "https://schema.org", "@graph": [event, breadcrumb] };
}

export function buildMatchSeoHtml({ match, route, siteUrl = "https://korazero.com", teamNamesAr = {}, lang = "ar" }) {
  const isAr = lang === "ar";
  const home = isAr ? arTeam(match.home, teamNamesAr) : match.home;
  const away = isAr ? arTeam(match.away, teamNamesAr) : match.away;
  const competition = leagueName(match, lang);
  const arRoute = route.replace(/^\/en/, "");
  const enRoute = `/en${arRoute}`;
  const canonicalRoute = isAr ? arRoute : enRoute;
  const counterpart = isAr ? enRoute : arRoute;
  const ksa = formatKickoff(match.kickoffUtc, "Asia/Riyadh", lang);
  const title =
    match.status === "ended"
      ? isAr
        ? `${home} ضد ${away} — النتيجة والأهداف | ${competition} | كورة زيرو`
        : `${home} vs ${away} — result and goals | ${competition} | KoraZero`
      : isAr
        ? `مشاهدة مباراة ${home} و${away} بث مباشر | ${competition} | كورة زيرو`
        : `Watch ${home} vs ${away} live | ${competition} | KoraZero`;
  const description = isAr
    ? `مباراة ${home} ضد ${away} ضمن ${competition}. الموعد بتوقيت مكة: ${ksa}${match.score && match.score !== "VS" ? `، والنتيجة ${match.score}` : ""}.`
    : `${home} vs ${away} in ${competition}. Makkah kickoff: ${ksa}${match.score && match.score !== "VS" ? `; score ${match.score}` : ""}.`;
  const schema = buildSchema({ match, route: canonicalRoute, siteUrl, teamNamesAr, lang });
  const image = socialImage(match, siteUrl);
  const watch = match.channelId
    ? `<div class="seo-actions"><a class="seo-btn seo-btn--primary" href="/watch?ch=${encodeURIComponent(match.channelId)}">${isAr ? "شاهد البث المباشر" : "Watch live"}</a><a class="seo-btn" href="/matches">${isAr ? "كل مباريات اليوم" : "All matches"}</a></div>`
    : `<div class="seo-actions"><a class="seo-btn" href="/matches">${isAr ? "كل مباريات اليوم" : "All matches"}</a></div>`;
  const body = [
    resultSection(match, lang),
    overviewSection(match, lang),
    timeSection(match, lang),
    h2hSection(match, lang, teamNamesAr),
    recentFormSection(match, lang, teamNamesAr),
    lineupsSection(match, lang, teamNamesAr),
    broadcastersSection(match, lang),
    coverageSection(match, lang),
  ]
    .filter(Boolean)
    .join("\n");

  return `<!doctype html>
<html lang="${lang}" dir="${isAr ? "rtl" : "ltr"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
  <meta name="theme-color" content="#060914">
  <link rel="canonical" href="${siteUrl}${canonicalRoute}">
  <link rel="alternate" hreflang="ar" href="${siteUrl}${arRoute}">
  <link rel="alternate" hreflang="en" href="${siteUrl}${enRoute}">
  <link rel="alternate" hreflang="x-default" href="${siteUrl}${arRoute}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="${isAr ? "ar_AR" : "en_US"}">
  <meta property="og:site_name" content="KoraZero">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${siteUrl}${canonicalRoute}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(image)}">
  <link rel="stylesheet" href="/assets/css/seo-pages.css?v=20260830matchseo">
  <script type="application/ld+json">${safeJson(schema)}</script>
</head>
<body>
  <main class="seo-wrap">
    <header class="seo-top">
      <a class="seo-brand" href="/" aria-label="KoraZero">Kora<b>Zero</b>${isAr ? " · كورة زيرو" : ""}</a>
      <nav class="seo-nav" aria-label="${isAr ? "روابط رئيسية" : "Main links"}">
        <a href="/matches">${isAr ? "مباريات اليوم" : "Matches"}</a>
        <a href="${escapeHtml(leagueRoute(match))}">${escapeHtml(competition)}</a>
        <a href="/matches/archive">${isAr ? "أرشيف المباريات" : "Match archive"}</a>
        <a href="/tournament">${isAr ? "كأس العالم 2026" : "World Cup 2026"}</a>
        <a href="${escapeHtml(counterpart)}" hreflang="${isAr ? "en" : "ar"}">${isAr ? "English" : "العربية"}</a>
      </nav>
    </header>
    <section class="seo-hero">
      <span class="seo-kicker">${escapeHtml(statusLabel(match, lang))}</span>
      <h1>${escapeHtml(home)} ${isAr ? "ضد" : "vs"} ${escapeHtml(away)}</h1>
      <p class="seo-lead">${escapeHtml(competition)}</p>
    </section>
    <p class="seo-crumbs"><a href="/">${isAr ? "الرئيسية" : "Home"}</a> <span>←</span> <a href="${escapeHtml(leagueRoute(match))}">${escapeHtml(competition)}</a> <span>←</span> ${escapeHtml(home)} ${isAr ? "ضد" : "vs"} ${escapeHtml(away)}</p>
    ${watch}
    ${body}
    <footer class="seo-footer">${isAr ? "تعرض هذه الصفحة فقط بيانات المباراة المتاحة من مصادر الجدول، من دون معلومات تقديرية أو حقول فارغة." : "This page only shows match data available from the schedule sources, without estimated or placeholder fields."}</footer>
  </main>
</body>
</html>`;
}
