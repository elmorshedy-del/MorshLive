const SITE_NAME = "كورة زيرو";

export const LEAGUE_META = Object.freeze({
  epl: {
    slug: "premier-league",
    nameAr: "الدوري الإنجليزي الممتاز",
    nameEn: "Premier League",
    titleAr: "مباريات الدوري الإنجليزي اليوم مباشر — المواعيد والقنوات",
    descriptionAr:
      "مباريات الدوري الإنجليزي اليوم مباشر مع المواعيد والتوقيت المحلي والنتائج والقنوات والمعلّقين وروابط تفاصيل كل مباراة على كورة زيرو.",
  },
  laliga: {
    slug: "la-liga",
    nameAr: "الدوري الإسباني",
    nameEn: "La Liga",
    titleAr: "مباريات الدوري الإسباني اليوم مباشر — المواعيد والقنوات",
    descriptionAr:
      "مباريات الدوري الإسباني اليوم مباشر مع المواعيد والتوقيت المحلي والنتائج والقنوات والمعلّقين وروابط تفاصيل كل مباراة على كورة زيرو.",
  },
  ucl: {
    slug: "champions-league",
    nameAr: "دوري أبطال أوروبا",
    nameEn: "UEFA Champions League",
    titleAr: "مباريات دوري أبطال أوروبا القادمة — المواعيد والقنوات",
    descriptionAr:
      "مباريات دوري أبطال أوروبا القادمة والجارية والمنتهية مع المواعيد والتوقيت المحلي والنتائج والقنوات والمعلّقين على كورة زيرو.",
  },
});

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function arabiaDayIso(utcIso, offsetHours = 3) {
  const ms = Date.parse(utcIso || "");
  if (Number.isNaN(ms)) return "";
  return new Date(ms + offsetHours * 3_600_000).toISOString().slice(0, 10);
}

function nextIsoDay(day, amount = 1) {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms)) return "";
  return new Date(ms + amount * 86_400_000).toISOString().slice(0, 10);
}

export function leaguePath(competition) {
  const meta = LEAGUE_META[competition];
  return meta ? `/league/${meta.slug}` : "";
}

export function matchPagePath(match) {
  const day = arabiaDayIso(match?.kickoffUtc);
  const teams = [slugify(match?.home), slugify(match?.away)].filter(Boolean).join("-vs-");
  if (!day || !teams) return "";
  return `/match/${day}/${teams}`;
}

function teamPagePath(team) {
  const slug = slugify(team);
  return slug ? `/team/${slug}` : "";
}

function datePagePath(day) {
  return day ? `/matches/${day}` : "";
}

function statusLabelAr(status) {
  if (status === "live") return "مباشر الآن";
  if (status === "ended") return "انتهت";
  return "قادمة";
}

function schemaEventStatus(status) {
  if (status === "live") return "https://schema.org/EventInProgress";
  if (status === "ended") return "https://schema.org/EventCompleted";
  return "https://schema.org/EventScheduled";
}

function formatKickoffAr(iso) {
  const ms = Date.parse(iso || "");
  if (Number.isNaN(ms)) return "";
  return new Intl.DateTimeFormat("ar-EG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Riyadh",
  }).format(new Date(ms));
}

function displayTeam(team, teamNamesAr) {
  return teamNamesAr?.[team] || team || "";
}

function leagueName(match) {
  return LEAGUE_META[match?.competition]?.nameAr || match?.leagueAr || match?.league || "كرة القدم";
}

function pageShell({ title, description, canonical, heading, lead, body, schema, siteUrl, summary = "" }) {
  const jsonLd = JSON.stringify(schema).replace(/</g, "\\u003c");
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeCanonical = escapeHtml(`${siteUrl}${canonical}`);
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
  <meta name="theme-color" content="#060914">
  <link rel="canonical" href="${safeCanonical}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="ar_AR">
  <meta property="og:site_name" content="KoraZero">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:url" content="${safeCanonical}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="/assets/css/seo-pages.css?v=20260829">
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body>
  <main class="seo-wrap">
    <header class="seo-top">
      <a class="seo-brand" href="/" aria-label="KoraZero">Kora<b>Zero</b> · كورة زيرو</a>
      <nav class="seo-nav" aria-label="روابط رئيسية">
        <a href="/matches">مباريات اليوم</a>
        <a href="/league/premier-league">الدوري الإنجليزي</a>
        <a href="/league/la-liga">الدوري الإسباني</a>
        <a href="/league/champions-league">دوري الأبطال</a>
        <a href="/world-cup-2026">كأس العالم 2026</a>
      </nav>
    </header>
    <section class="seo-hero">
      <span class="seo-kicker">جدول كورة زيرو</span>
      <h1>${escapeHtml(heading)}</h1>
      <p class="seo-lead">${escapeHtml(lead)}</p>
      ${summary}
    </section>
    ${body}
    <footer class="seo-footer">تُعرض المواعيد حسب توقيت جهازك تلقائياً، وتُحدّث بيانات النتائج والقنوات والمعلّقين من نفس مصدر جدول <a href="/">كورة زيرو</a>.</footer>
  </main>
</body>
</html>`;
}

function itemListSchema(matches, siteUrl, teamNamesAr) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: matches.map((match, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: `${displayTeam(match.home, teamNamesAr)} ضد ${displayTeam(match.away, teamNamesAr)}`,
      url: `${siteUrl}${matchPagePath(match)}`,
    })),
  };
}

function renderSummary(matches) {
  const live = matches.filter((match) => match.status === "live").length;
  const upcoming = matches.filter((match) => match.status === "upcoming").length;
  return `<div class="seo-summary">
    <div class="seo-stat"><strong>${matches.length}</strong><span>مباراة في الجدول</span></div>
    <div class="seo-stat"><strong>${live}</strong><span>مباشر الآن</span></div>
    <div class="seo-stat"><strong>${upcoming}</strong><span>قادمة</span></div>
  </div>`;
}

function renderLeagueStrip() {
  return `<section class="seo-section" aria-labelledby="seo-leagues-title">
    <div class="seo-section-head"><h2 id="seo-leagues-title">أهم البطولات</h2><p>صفحات ثابتة ومباشرة لكل بطولة</p></div>
    <div class="seo-leagues">
      ${Object.values(LEAGUE_META)
        .map(
          (meta) =>
            `<a class="seo-league" href="/league/${escapeHtml(meta.slug)}"><strong>${escapeHtml(meta.nameAr)}</strong><span>المواعيد · النتائج · القنوات</span></a>`,
        )
        .join("\n")}
    </div>
  </section>`;
}

function renderMatchCard(match, teamNamesAr) {
  const home = displayTeam(match.home, teamNamesAr);
  const away = displayTeam(match.away, teamNamesAr);
  const path = matchPagePath(match);
  const league = leagueName(match);
  const leagueUrl = leaguePath(match.competition);
  const statusClass = match.status === "live" ? " seo-live" : "";
  const channel = match.channel ? `<span>القناة: ${escapeHtml(match.channel)}</span>` : "";
  const commentator = match.commentator ? `<span>المعلّق: ${escapeHtml(match.commentator)}</span>` : "";
  const score =
    match.score && match.score !== "VS" ? `<span class="seo-score">${escapeHtml(match.score)}</span>` : "";
  const leagueMarkup = leagueUrl
    ? `<a href="${escapeHtml(leagueUrl)}">${escapeHtml(league)}</a>`
    : `<span>${escapeHtml(league)}</span>`;
  const watchLink = match.channelId
    ? `<a class="seo-btn seo-btn--primary" href="/watch?ch=${encodeURIComponent(match.channelId)}">شاهد البث</a>`
    : "";
  return `<article class="seo-card">
    <h3><a class="seo-match-link" href="${escapeHtml(path)}">${escapeHtml(home)} ضد ${escapeHtml(away)}</a></h3>
    <div class="seo-meta">
      ${leagueMarkup}
      <span>${escapeHtml(formatKickoffAr(match.kickoffUtc))}</span>
      <span class="${statusClass.trim()}">${escapeHtml(statusLabelAr(match.status))}</span>
      ${score}${channel}${commentator}
    </div>
    <div class="seo-actions">
      <a class="seo-btn" href="${escapeHtml(path)}">تفاصيل المباراة</a>
      ${watchLink}
    </div>
  </article>`;
}

function renderMatchList(matches, teamNamesAr, emptyText = "لا توجد مباريات في هذه الصفحة حالياً.") {
  if (!matches.length) return `<div class="seo-empty"><p>${escapeHtml(emptyText)}</p></div>`;
  return `<div class="seo-grid">${matches.map((match) => renderMatchCard(match, teamNamesAr)).join("\n")}</div>`;
}

function renderMatchSection(title, matches, teamNamesAr, note = "") {
  return `<section class="seo-section">
    <div class="seo-section-head"><h2>${escapeHtml(title)}</h2>${note ? `<p>${escapeHtml(note)}</p>` : ""}</div>
    ${renderMatchList(matches, teamNamesAr)}
  </section>`;
}

function sportsEventSchema(match, siteUrl, teamNamesAr) {
  const home = displayTeam(match.home, teamNamesAr);
  const away = displayTeam(match.away, teamNamesAr);
  const schema = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `${home} ضد ${away}`,
    url: `${siteUrl}${matchPagePath(match)}`,
    startDate: match.kickoffUtc,
    eventStatus: schemaEventStatus(match.status),
    sport: "Football",
    homeTeam: { "@type": "SportsTeam", name: home },
    awayTeam: { "@type": "SportsTeam", name: away },
  };
  if (match.venue) schema.location = { "@type": "Place", name: match.venue };
  return schema;
}

function generatedFile(prefix, slug) {
  return `/generated/seo/${prefix}-${slug}.html`;
}

export function buildSeoPages(payload, options = {}) {
  const siteUrl = String(options.siteUrl || "https://korazero.com").replace(/\/$/, "");
  const teamNamesAr = options.teamNamesAr || {};
  const sourceMatches = Array.isArray(payload?.matches) ? payload.matches : [];
  const matches = sourceMatches
    .filter((match) => match?.home && match?.away && matchPagePath(match))
    .sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc));
  const today = payload?.date || arabiaDayIso(new Date().toISOString());
  const tomorrow = nextIsoDay(today);
  const pages = [];

  const pushPage = (route, file, html) => pages.push({ route, file, html });

  const byDay = new Map();
  const byLeague = new Map();
  const byTeam = new Map();
  for (const match of matches) {
    const day = arabiaDayIso(match.kickoffUtc);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(match);
    if (LEAGUE_META[match.competition]) {
      if (!byLeague.has(match.competition)) byLeague.set(match.competition, []);
      byLeague.get(match.competition).push(match);
    }
    for (const team of [match.home, match.away]) {
      if (!byTeam.has(team)) byTeam.set(team, []);
      byTeam.get(team).push(match);
    }
  }

  const todayMatches = byDay.get(today) || [];
  const tomorrowMatches = byDay.get(tomorrow) || [];
  const laterMatches = matches.filter((match) => arabiaDayIso(match.kickoffUtc) > tomorrow).slice(0, 12);
  const hubBody = [
    renderLeagueStrip(),
    renderMatchSection("مباريات اليوم", todayMatches, teamNamesAr, `حسب توقيتك المحلي · ${today}`),
    tomorrowMatches.length
      ? renderMatchSection("مباريات الغد", tomorrowMatches, teamNamesAr, `حسب توقيتك المحلي · ${tomorrow}`)
      : "",
    laterMatches.length
      ? renderMatchSection("المباريات القادمة", laterMatches, teamNamesAr, "أقرب المباريات بعد الغد")
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  pushPage(
    "/matches",
    generatedFile("matches", "hub"),
    pageShell({
      title: `بث مباشر مباريات اليوم — المواعيد والقنوات | ${SITE_NAME}`,
      description:
        "بث مباشر مباريات اليوم مع جدول اليوم والغد، التوقيت المحلي، القنوات الناقلة، المعلّقين، النتائج وروابط كل مباراة على كورة زيرو.",
      canonical: "/matches",
      heading: "بث مباشر مباريات اليوم",
      lead: "جدول مباريات اليوم والغد في مكان واحد: وقت البداية حسب توقيتك المحلي، البطولة، القناة، المعلّق والنتيجة عند توفرها، مع رابط مستقل لكل مباراة.",
      body: hubBody,
      schema: itemListSchema(matches.slice(0, 40), siteUrl, teamNamesAr),
      siteUrl,
      summary: renderSummary(matches),
    }),
  );

  for (const [day, dayMatches] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const route = datePagePath(day);
    pushPage(
      route,
      generatedFile("date", day),
      pageShell({
        title: `مباريات ${day} — المواعيد والنتائج | ${SITE_NAME}`,
        description: `مواعيد ونتائج مباريات كرة القدم يوم ${day} مع التوقيت المحلي والقنوات والمعلّقين وروابط تفاصيل كل مباراة على كورة زيرو.`,
        canonical: route,
        heading: `مباريات ${day}`,
        lead: "صفحة يومية ثابتة للمواعيد والنتائج والقنوات، مع روابط مباشرة إلى تفاصيل كل مباراة.",
        body: renderMatchSection("جدول المباريات", dayMatches, teamNamesAr, "حسب توقيتك المحلي"),
        schema: itemListSchema(dayMatches, siteUrl, teamNamesAr),
        siteUrl,
        summary: renderSummary(dayMatches),
      }),
    );
  }

  for (const [competition, leagueMatches] of byLeague.entries()) {
    const meta = LEAGUE_META[competition];
    const route = leaguePath(competition);
    pushPage(
      route,
      generatedFile("league", meta.slug),
      pageShell({
        title: `${meta.titleAr} | ${SITE_NAME}`,
        description: meta.descriptionAr,
        canonical: route,
        heading: meta.titleAr,
        lead: `كل مباريات ${meta.nameAr} الموجودة في جدول كورة زيرو، مرتبة حسب موعد البداية مع القنوات والمعلّقين والنتائج عند توفرها.`,
        body: renderMatchSection(`جدول ${meta.nameAr}`, leagueMatches, teamNamesAr, "الأقرب أولاً"),
        schema: itemListSchema(leagueMatches, siteUrl, teamNamesAr),
        siteUrl,
        summary: renderSummary(leagueMatches),
      }),
    );
  }

  const eligibleTeams = [...byTeam.entries()].filter(([, teamMatches]) => teamMatches.length >= 2);
  for (const [team, teamMatches] of eligibleTeams) {
    const teamAr = displayTeam(team, teamNamesAr);
    const route = teamPagePath(team);
    pushPage(
      route,
      generatedFile("team", slugify(team)),
      pageShell({
        title: `مباريات ${teamAr} اليوم والقادمة — المواعيد والنتائج | ${SITE_NAME}`,
        description: `مباريات ${teamAr} اليوم والقادمة مع التوقيت المحلي والنتائج والبطولة والقناة والمعلّق عند توفر البيانات على كورة زيرو.`,
        canonical: route,
        heading: `مباريات ${teamAr}`,
        lead: "مواعيد ونتائج مباريات الفريق الظاهرة في جدول كورة زيرو، مرتبة زمنياً مع تفاصيل كل مباراة.",
        body: renderMatchSection(`جدول ${teamAr}`, teamMatches, teamNamesAr),
        schema: itemListSchema(teamMatches, siteUrl, teamNamesAr),
        siteUrl,
        summary: renderSummary(teamMatches),
      }),
    );
  }

  for (const match of matches) {
    const home = displayTeam(match.home, teamNamesAr);
    const away = displayTeam(match.away, teamNamesAr);
    const route = matchPagePath(match);
    const isToday = arabiaDayIso(match.kickoffUtc) === today;
    const title = isToday
      ? `${home} ضد ${away} بث مباشر اليوم — الموعد والقناة | ${SITE_NAME}`
      : `${home} ضد ${away} — الموعد والنتيجة | ${SITE_NAME}`;
    const heading = isToday ? `${home} ضد ${away} بث مباشر اليوم` : `${home} ضد ${away}`;
    const details = [
      `<p><strong>البطولة:</strong> ${escapeHtml(leagueName(match))}</p>`,
      `<p><strong>الموعد:</strong> ${escapeHtml(formatKickoffAr(match.kickoffUtc))} حسب توقيتك المحلي</p>`,
      `<p><strong>الحالة:</strong> ${escapeHtml(statusLabelAr(match.status))}</p>`,
      match.score && match.score !== "VS"
        ? `<p><strong>النتيجة:</strong> ${escapeHtml(match.score)}</p>`
        : "",
      match.channel ? `<p><strong>القناة:</strong> ${escapeHtml(match.channel)}</p>` : "",
      match.commentator ? `<p><strong>المعلّق:</strong> ${escapeHtml(match.commentator)}</p>` : "",
      match.venue ? `<p><strong>الملعب:</strong> ${escapeHtml(match.venue)}</p>` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const leagueUrl = leaguePath(match.competition);
    const breadcrumbs = `<p class="seo-crumbs"><a href="/matches">مباريات اليوم</a>${leagueUrl ? ` <span>←</span> <a href="${escapeHtml(leagueUrl)}">${escapeHtml(leagueName(match))}</a>` : ""}</p>`;
    const watchCta = match.channelId
      ? `<div class="seo-actions"><a class="seo-btn seo-btn--primary" href="/watch?ch=${encodeURIComponent(match.channelId)}">شاهد البث المباشر</a><a class="seo-btn" href="/matches">كل مباريات اليوم</a></div>`
      : `<div class="seo-actions"><a class="seo-btn" href="/matches">كل مباريات اليوم</a></div>`;
    pushPage(
      route,
      generatedFile(
        "match",
        `${arabiaDayIso(match.kickoffUtc)}-${slugify(match.home)}-vs-${slugify(match.away)}`,
      ),
      pageShell({
        title,
        description: `تفاصيل مباراة ${home} ضد ${away}: الموعد والتوقيت المحلي، الحالة، النتيجة، البطولة، القناة والمعلّق عند توفر البيانات.`,
        canonical: route,
        heading,
        lead: `${leagueName(match)} · ${formatKickoffAr(match.kickoffUtc)} حسب توقيتك المحلي · ${statusLabelAr(match.status)}`,
        body: `${breadcrumbs}<article class="seo-card"><div class="seo-detail">${details}</div>${watchCta}</article>`,
        schema: sportsEventSchema(match, siteUrl, teamNamesAr),
        siteUrl,
      }),
    );
  }

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map((page) => `  <url><loc>${escapeHtml(siteUrl + page.route)}</loc><lastmod>${today}</lastmod></url>`)
    .join("\n")}\n</urlset>\n`;
  const redirectLines = [
    ...pages.map((page) => `${page.route}  ${page.file}  200`),
    "/matches/today  /matches  301",
  ];

  return { pages, sitemapXml, redirectLines, today, matchCount: matches.length };
}
