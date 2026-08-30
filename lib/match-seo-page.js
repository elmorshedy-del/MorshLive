const LEAGUE_ROUTES = Object.freeze({
  epl: "/league/premier-league",
  laliga: "/league/la-liga",
  ucl: "/league/champions-league",
});

const LEAGUE_EN = Object.freeze({
  epl: "Premier League",
  laliga: "La Liga",
  ucl: "UEFA Champions League",
});

const ZONES = Object.freeze([
  { key: "ksa", ar: "مكة المكرمة (السعودية)", en: "Makkah (Saudi Arabia)", zone: "Asia/Riyadh" },
  { key: "uae", ar: "الإمارات", en: "UAE", zone: "Asia/Dubai" },
  { key: "egypt", ar: "مصر", en: "Egypt", zone: "Africa/Cairo" },
  { key: "uk", ar: "المملكة المتحدة", en: "United Kingdom", zone: "Europe/London" },
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

function routeForLeague(match) {
  return LEAGUE_ROUTES[match?.competition] || "/matches";
}

function statusLabel(match, lang) {
  const eventStatus = match?.seoEventStatus || "";
  if (eventStatus === "EventPostponed") return lang === "ar" ? "تأجلت" : "Postponed";
  if (eventStatus === "EventCancelled") return lang === "ar" ? "أُلغيت" : "Cancelled";
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

function isoWithZone(iso, timeZone) {
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
  const offsetRaw = part("timeZoneName").replace("GMT", "") || "+00:00";
  const offset = /^[+-]\d{2}:\d{2}$/.test(offsetRaw) ? offsetRaw : "+00:00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}${offset}`;
}

function htmlTimeRows(match, lang) {
  if (!match?.kickoffUtc) return "";
  const rows = ZONES.map((item) => {
    const value = formatKickoff(match.kickoffUtc, item.zone, lang);
    if (!value) return "";
    return `<li><strong>${escapeHtml(lang === "ar" ? item.ar : item.en)}:</strong> <time datetime="${escapeHtml(
      isoWithZone(match.kickoffUtc, item.zone),
    )}">${escapeHtml(value)}</time></li>`;
  }).filter(Boolean);
  if (!rows.length) return "";
  return `<section class="seo-section"><div class="seo-section-head"><h2>${lang === "ar" ? "موعد المباراة" : "Kickoff times"}</h2></div><ul class="seo-detail">${rows.join("")}</ul></section>`;
}

function resultCodeLabel(code, lang) {
  const labels = lang === "ar" ? { W: "فوز", D: "تعادل", L: "خسارة" } : { W: "Win", D: "Draw", L: "Loss" };
  return labels[String(code || "").toUpperCase()] || String(code || "");
}

function htmlRecentForm(match, lang, teamNamesAr) {
  const form = match?.recentForm;
  if (!form || (!form.home?.length && !form.away?.length)) return "";
  const home = lang === "ar" ? arTeam(match.home, teamNamesAr) : match.home;
  const away = lang === "ar" ? arTeam(match.away, teamNamesAr) : match.away;
  const renderTeam = (name, rows, record) => {
    if (!rows?.length && !record) return "";
    const recordRow = record
      ? `<p><strong>${lang === "ar" ? "سجل البطولة" : "Competition record"}:</strong> ${escapeHtml(record)}</p>`
      : "";
    const list = (rows || [])
      .map((row) => {
        const opponent = lang === "ar" ? arTeam(row.opponent, teamNamesAr) : row.opponent;
        const result = resultCodeLabel(row.result, lang);
        const competition = row.competition ? ` · ${escapeHtml(row.competition)}` : "";
        return `<li><strong>${escapeHtml(result)}</strong> · ${escapeHtml(opponent || "")} · ${escapeHtml(row.score || "")}${competition}</li>`;
      })
      .join("");
    return `<div class="seo-card"><h3>${escapeHtml(name)}</h3>${recordRow}${list ? `<ul class="seo-detail">${list}</ul>` : ""}</div>`;
  };
  const cards = [renderTeam(home, form.home, match.homeRecord), renderTeam(away, form.away, match.awayRecord)]
    .filter(Boolean)
    .join("");
  if (!cards) return "";
  return `<section class="seo-section"><div class="seo-section-head"><h2>${lang === "ar" ? "آخر المباريات" : "Recent form"}</h2></div><div class="seo-grid">${cards}</div></section>`;
}

function localizedH2hSummary(match, lang, teamNamesAr) {
  const source = String(match?.headToHead?.summary || "").trim();
  if (!source || lang !== "ar") return source;
  const lead = /^([A-Z0-9]+) leads series (\d+)-(\d+)-(\d+)$/i.exec(source);
  if (lead) {
    const abbrev = lead[1].toUpperCase();
    const team = abbrev === String(match.homeAbbr || "").toUpperCase() ? arTeam(match.home, teamNamesAr) : abbrev === String(match.awayAbbr || "").toUpperCase() ? arTeam(match.away, teamNamesAr) : abbrev;
    return `${team} يتفوق في آخر المواجهات: ${lead[2]} فوز، ${lead[3]} خسارة، ${lead[4]} تعادل`;
  }
  const tied = /^series tied (\d+)-(\d+)-(\d+)$/i.exec(source);
  if (tied) return `التعادل يحسم آخر المواجهات: ${tied[1]}-${tied[2]}-${tied[3]}`;
  return source;
}

function htmlHeadToHead(match, lang, teamNamesAr) {
  if (!match?.headToHead) return "";
  const summary = localizedH2hSummary(match, lang, teamNamesAr);
  const total = match.headToHead.totalCompetitions;
  const details = [
    summary ? `<p>${escapeHtml(summary)}</p>` : "",
    total ? `<p><strong>${lang === "ar" ? "عدد المواجهات في السجل" : "Matches in record"}:</strong> ${total}</p>` : "",
  ]
    .filter(Boolean)
    .join("");
  if (!details) return "";
  return `<section class="seo-section"><div class="seo-section-head"><h2>${lang === "ar" ? "المواجهات المباشرة" : "Head-to-head"}</h2></div><div class="seo-card">${details}</div></section>`;
}

function lineupNames(side) {
  return side?.starters?.map((player) => player?.name).filter(Boolean) || [];
}

function htmlLineups(match, lang, teamNamesAr) {
  const homeRows = lineupNames(match?.lineups?.home);
  const awayRows = lineupNames(match?.lineups?.away);
  if (!homeRows.length || !awayRows.length) return "";
  const home = lang === "ar" ? arTeam(match.home, teamNamesAr) : match.home;
  const away = lang === "ar" ? arTeam(match.away, teamNamesAr) : match.away;
  const render = (name, side, names) => {
    const formation = side?.formation ? `<p><strong>${lang === "ar" ? "الخطة" : "Formation"}:</strong> ${escapeHtml(side.formation)}</p>` : "";
    return `<div class="seo-card"><h3>${escapeHtml(name)}</h3>${formation}<ol class="seo-detail">${names.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ol></div>`;
  };
  return `<section class="seo-section"><div class="seo-section-head"><h2>${lang === "ar" ? "التشكيل الرسمي" : "Official lineups"}</h2></div><div class="seo-grid">${render(home, match.lineups.home, homeRows)}${render(away, match.lineups.away, awayRows)}</div></section>`;
}

function regionLabel(region, lang) {
  const code = String(region || "").toLowerCase();
  const names = {
    us: { ar: "الولايات المتحدة", en: "United States" },
    uk: { ar: "المملكة المتحدة", en: "United Kingdom" },
    gb: { ar: "المملكة المتحدة", en: "United Kingdom" },
    ae: { ar: "الإمارات", en: "UAE" },
    sa: { ar: "السعودية", en: "Saudi Arabia" },
    eg: { ar: "مصر", en: "Egypt" },
  };
  return names[code]?.[lang] || String(region || "").toUpperCase();
}

function htmlBroadcasters(match, lang) {
  const rows = match?.broadcasters || [];
  if (!rows.length) return "";
  return `<section class="seo-section"><div class="seo-section-head"><h2>${lang === "ar" ? "حقوق البث حسب السوق" : "Broadcast rights by market"}</h2></div><ul class="seo-detail">${rows
    .map((row) => {
      const region = regionLabel(row.region, lang);
      const type = row.type ? ` · ${escapeHtml(row.type)}` : "";
      return `<li><strong>${escapeHtml(region || (lang === "ar" ? "السوق المعلن" : "Listed market"))}:</strong> ${escapeHtml(row.name)}${type}</li>`;
    })
    .join("")}</ul></section>`;
}

function htmlCoverage(match, lang) {
  const rows = [
    match?.channel ? `<p><strong>${lang === "ar" ? "القناة" : "Channel"}:</strong> ${escapeHtml(match.channel)}</p>` : "",
    match?.commentator ? `<p><strong>${lang === "ar" ? "المعلّق" : "Commentator"}:</strong> ${escapeHtml(match.commentator)}</p>` : "",
  ].filter(Boolean);
  if (!rows.length) return "";
  return `<section class="seo-section"><div class="seo-section-head"><h2>${lang === "ar" ? "معلومات التغطية" : "Coverage information"}</h2></div><div class="seo-card">${rows.join("")}</div></section>`;
}

function htmlGoals(match, lang) {
  if (!match?.goals?.length) return "";
  return `<div class="seo-card"><h3>${lang === "ar" ? "الأهداف" : "Goals"}</h3><ul class="seo-detail">${match.goals
    .map((goal) => {
      const flags = [goal.penalty ? (lang === "ar" ? "ركلة جزاء" : "penalty") : "", goal.own ? (lang === "ar" ? "هدف عكسي" : "own goal") : ""]
        .filter(Boolean)
        .join(" · ");
      return `<li>${escapeHtml(goal.scorer || (lang === "ar" ? "مسجل الهدف" : "Scorer"))} · ${escapeHtml(goal.minute || "")}${flags ? ` · ${escapeHtml(flags)}` : ""}</li>`;
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

function htmlHighlights(match, lang) {
  const rows = highlightRows(match);
  if (!rows.length) return "";
  return `<div class="seo-card"><h3>${lang === "ar" ? "الملخص والأهداف" : "Highlights"}</h3><ul class="seo-detail">${rows
    .map((row) => `<li><a href="${escapeHtml(row.videoUrl)}">${escapeHtml(row.title || (lang === "ar" ? "مشاهدة الملخص" : "Watch highlights"))}</a></li>`)
    .join("")}</ul></div>`;
}

function htmlResult(match, lang) {
  if (match?.status !== "ended" && match?.status !== "live") return "";
  const title = match.status === "ended" ? (lang === "ar" ? "النتيجة النهائية" : "Final score") : lang === "ar" ? "النتيجة المباشرة" : "Live score";
  const score = match?.score && match.score !== "VS" ? `<p class="seo-score">${escapeHtml(match.score)}</p>` : "";
  return `<section class="seo-section seo-result"><div class="seo-section-head"><h2>${title}</h2></div>${score}${htmlGoals(match, lang)}${match.status === "ended" ? htmlHighlights(match, lang) : ""}</section>`;
}

function htmlOverview(match, lang, teamNamesAr) {
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

function bestMatchImage(match, siteUrl) {
  const specific =
    match?.highlights?.full?.thumbnail ||
    match?.highlights?.goals?.thumbnail ||
    match?.highlight?.thumbnail ||
    match?.clips?.find((row) => row?.thumbnail)?.thumbnail ||
    "";
  return {
    specific,
    social: specific || `${siteUrl}/assets/img/korazero-showdown.jpg`,
  };
}

function sportsTeamSchema(info, arName, enName) {
  const team = { "@type": "SportsTeam", name: arName || enName || "" };
  if (enName && enName !== arName) team.alternateName = enName;
  if (info?.url) {
    team["@id"] = info.url;
    team.url = info.url;
  }
  return team;
}

function locationSchema(match) {
  const venue = match?.venueInfo;
  if (!venue?.name) return null;
  const address = { "@type": "PostalAddress" };
  if (venue.streetAddress) address.streetAddress = venue.streetAddress;
  if (venue.city) address.addressLocality = venue.city;
  if (venue.country) address.addressCountry = venue.country;
  const out = { "@type": "Place", name: venue.name };
  if (Object.keys(address).length > 1) out.address = address;
  return out;
}

function eventStatusUrl(match) {
  const value = match?.seoEventStatus || (match?.status === "live" ? "EventInProgress" : match?.status === "ended" ? "EventCompleted" : "EventScheduled");
  return `https://schema.org/${value}`;
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
    startDate: isoWithZone(match.kickoffUtc, "Asia/Riyadh"),
    eventStatus: eventStatusUrl(match),
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    sport: "Football",
    description:
      lang === "ar"
        ? `مباراة ${home} ضد ${away} ضمن ${competition} على كورة زيرو.`
        : `${home} vs ${away} in ${competition} on KoraZero.`,
    homeTeam: sportsTeamSchema(match.homeTeamInfo, homeAr, match.home),
    awayTeam: sportsTeamSchema(match.awayTeamInfo, awayAr, match.away),
  };
  const location = locationSchema(match);
  if (location) event.location = location;
  const image = bestMatchImage(match, siteUrl).specific;
  if (image) event.image = [image];

  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: lang === "ar" ? "الرئيسية" : "Home", item: `${siteUrl}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: competition,
        item: `${siteUrl}${routeForLeague(match)}`,
      },
      { "@type": "ListItem", position: 3, name: `${home} ${lang === "ar" ? "ضد" : "vs"} ${away}`, item: `${siteUrl}${route}` },
    ],
  };
  return { "@context": "https://schema.org", "@graph": [event, breadcrumb] };
}

export function w3cLastmod(value) {
  const parsed = Date.parse(value || "");
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toISOString().replace(/\.000Z$/, "+00:00").replace(/Z$/, "+00:00");
}

export function buildMatchSeoHtml({ match, route, siteUrl = "https://korazero.com", teamNamesAr = {}, lang = "ar", payloadDate = "" }) {
  const isAr = lang === "ar";
  const dir = isAr ? "rtl" : "ltr";
  const homeAr = arTeam(match.home, teamNamesAr);
  const awayAr = arTeam(match.away, teamNamesAr);
  const home = isAr ? homeAr : match.home;
  const away = isAr ? awayAr : match.away;
  const competition = leagueName(match, lang);
  const day = String(match.kickoffUtc || "").slice(0, 10);
  const isToday = payloadDate && day === payloadDate;
  const title = isAr
    ? isToday
      ? `${home} ضد ${away} بث مباشر اليوم — الموعد والقناة | كورة زيرو`
      : `${home} ضد ${away} — الموعد والنتيجة | كورة زيرو`
    : isToday
      ? `${home} vs ${away} live today — kickoff and channel | KoraZero`
      : `${home} vs ${away} — kickoff and result | KoraZero`;
  const ksa = formatKickoff(match.kickoffUtc, "Asia/Riyadh", lang);
  const description = isAr
    ? `تفاصيل مباراة ${home} ضد ${away} ضمن ${competition}. موعد المباراة بتوقيت مكة: ${ksa}${match.score && match.score !== "VS" ? `، والنتيجة ${match.score}` : ""}.`
    : `${home} vs ${away} in ${competition}. Kickoff in Makkah time: ${ksa}${match.score && match.score !== "VS" ? `; score ${match.score}` : ""}.`;
  const arRoute = route.replace(/^\/en/, "");
  const enRoute = `/en${arRoute}`;
  const canonicalRoute = isAr ? arRoute : enRoute;
  const counterpart = isAr ? enRoute : arRoute;
  const image = bestMatchImage(match, siteUrl);
  const schema = buildSchema({ match, route: canonicalRoute, siteUrl, teamNamesAr, lang });
  const breadcrumbs = `<p class="seo-crumbs"><a href="/">${isAr ? "الرئيسية" : "Home"}</a> <span>←</span> <a href="${escapeHtml(routeForLeague(match))}">${escapeHtml(competition)}</a> <span>←</span> ${escapeHtml(home)} ${isAr ? "ضد" : "vs"} ${escapeHtml(away)}</p>`;
  const watch = match.channelId
    ? `<div class="seo-actions"><a class="seo-btn seo-btn--primary" href="/watch?ch=${encodeURIComponent(match.channelId)}">${isAr ? "شاهد البث المباشر" : "Watch live"}</a><a class="seo-btn" href="/matches">${isAr ? "كل مباريات اليوم" : "All matches"}</a></div>`
    : `<div class="seo-actions"><a class="seo-btn" href="/matches">${isAr ? "كل مباريات اليوم" : "All matches"}</a></div>`;
  const body = [
    htmlResult(match, lang),
    htmlOverview(match, lang, teamNamesAr),
    htmlTimeRows(match, lang),
    htmlHeadToHead(match, lang, teamNamesAr),
    htmlRecentForm(match, lang, teamNamesAr),
    htmlLineups(match, lang, teamNamesAr),
    htmlBroadcasters(match, lang),
    htmlCoverage(match, lang),
  ]
    .filter(Boolean)
    .join("\n");

  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
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
  <meta property="og:image" content="${escapeHtml(image.social)}">
  <meta property="og:image:width" content="1374">
  <meta property="og:image:height" content="768">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(image.social)}">
  <link rel="stylesheet" href="/assets/css/seo-pages.css?v=20260829">
  <script type="application/ld+json">${safeJson(schema)}</script>
</head>
<body>
  <main class="seo-wrap">
    <header class="seo-top">
      <a class="seo-brand" href="/" aria-label="KoraZero">Kora<b>Zero</b>${isAr ? " · كورة زيرو" : ""}</a>
      <nav class="seo-nav" aria-label="${isAr ? "روابط رئيسية" : "Main links"}">
        <a href="/matches">${isAr ? "مباريات اليوم" : "Matches"}</a>
        <a href="${escapeHtml(routeForLeague(match))}">${escapeHtml(competition)}</a>
        <a href="/tournament">${isAr ? "كأس العالم 2026" : "World Cup 2026"}</a>
        <a href="${escapeHtml(counterpart)}" hreflang="${isAr ? "en" : "ar"}">${isAr ? "English" : "العربية"}</a>
      </nav>
    </header>
    <section class="seo-hero">
      <span class="seo-kicker">${escapeHtml(statusLabel(match, lang))}</span>
      <h1>${escapeHtml(home)} ${isAr ? "ضد" : "vs"} ${escapeHtml(away)}</h1>
      <p class="seo-lead">${escapeHtml(competition)}</p>
    </section>
    ${breadcrumbs}
    ${watch}
    ${body}
    <footer class="seo-footer">${isAr ? "تعرض هذه الصفحة فقط بيانات المباراة المتاحة من مصادر الجدول، من دون معلومات تقديرية أو حقول فارغة." : "This page only shows match data available from the schedule sources, without estimated or placeholder fields."}</footer>
  </main>
</body>
</html>`;
}
