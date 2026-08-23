const SITE_NAME = "كورة زيرو";

export const LEAGUE_META = Object.freeze({
  epl: {
    slug: "premier-league",
    nameAr: "الدوري الإنجليزي الممتاز",
    nameEn: "Premier League",
  },
  laliga: {
    slug: "la-liga",
    nameAr: "الدوري الإسباني",
    nameEn: "La Liga",
  },
  ucl: {
    slug: "champions-league",
    nameAr: "دوري أبطال أوروبا",
    nameEn: "UEFA Champions League",
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

function pageShell({ title, description, canonical, heading, lead, body, schema, siteUrl }) {
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
  <link rel="canonical" href="${safeCanonical}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="ar_AR">
  <meta property="og:site_name" content="KoraZero">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:url" content="${safeCanonical}">
  <meta name="twitter:card" content="summary">
  <script type="application/ld+json">${jsonLd}</script>
  <style>
    :root{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;color:#101828;background:#f5f7fb}
    *{box-sizing:border-box}body{margin:0}.wrap{max-width:980px;margin:auto;padding:20px}.top{display:flex;gap:14px;align-items:center;justify-content:space-between;padding:10px 0 22px}.brand{font-weight:800;font-size:1.35rem;color:#101828;text-decoration:none}.nav{display:flex;flex-wrap:wrap;gap:8px}.nav a,.pill{color:#344054;text-decoration:none;background:#fff;border:1px solid #e4e7ec;border-radius:999px;padding:8px 12px}.hero,.card{background:#fff;border:1px solid #e4e7ec;border-radius:18px;box-shadow:0 8px 28px rgba(16,24,40,.05)}.hero{padding:26px;margin-bottom:18px}h1{font-size:clamp(1.7rem,4vw,2.7rem);line-height:1.25;margin:0 0 10px}.lead{color:#475467;line-height:1.9;margin:0}.grid{display:grid;gap:12px}.card{padding:18px}.card h2,.card h3{margin:0 0 8px}.meta{display:flex;flex-wrap:wrap;gap:7px;color:#667085;font-size:.92rem}.match-link{color:#101828;text-decoration:none}.score{font-weight:800}.section-title{margin:28px 0 12px}.crumbs{font-size:.9rem;color:#667085;margin-bottom:12px}.crumbs a{color:#475467}footer{color:#667085;font-size:.9rem;padding:26px 0 10px;line-height:1.8}@media(max-width:640px){.top{align-items:flex-start;flex-direction:column}.hero,.card{border-radius:14px}}
  </style>
</head>
<body>
  <main class="wrap">
    <header class="top">
      <a class="brand" href="/">KoraZero · كورة زيرو</a>
      <nav class="nav" aria-label="روابط رئيسية">
        <a href="/matches/today">مباريات اليوم</a>
        <a href="/league/premier-league">الدوري الإنجليزي</a>
        <a href="/league/la-liga">الدوري الإسباني</a>
        <a href="/league/champions-league">دوري الأبطال</a>
        <a href="/tournament">أرشيف الملخصات</a>
      </nav>
    </header>
    <section class="hero">
      <h1>${escapeHtml(heading)}</h1>
      <p class="lead">${escapeHtml(lead)}</p>
    </section>
    ${body}
    <footer>هذه الصفحات تُنشأ تلقائياً من نفس بيانات المباريات الظاهرة في كورة زيرو، لتكون المواعيد والنتائج والقنوات والمعلّقون قابلة للقراءة مباشرةً بدون الاعتماد على JavaScript.</footer>
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

function renderMatchCard(match, teamNamesAr) {
  const home = displayTeam(match.home, teamNamesAr);
  const away = displayTeam(match.away, teamNamesAr);
  const path = matchPagePath(match);
  const league = leagueName(match);
  const leagueUrl = leaguePath(match.competition);
  const channel = match.channel ? `<span>القناة: ${escapeHtml(match.channel)}</span>` : "";
  const commentator = match.commentator ? `<span>المعلّق: ${escapeHtml(match.commentator)}</span>` : "";
  const score =
    match.score && match.score !== "VS" ? `<span class="score">${escapeHtml(match.score)}</span>` : "";
  const leagueMarkup = leagueUrl
    ? `<a class="pill" href="${escapeHtml(leagueUrl)}">${escapeHtml(league)}</a>`
    : `<span>${escapeHtml(league)}</span>`;
  return `<article class="card">
    <h3><a class="match-link" href="${escapeHtml(path)}">${escapeHtml(home)} ضد ${escapeHtml(away)}</a></h3>
    <div class="meta">
      ${leagueMarkup}
      <span>${escapeHtml(formatKickoffAr(match.kickoffUtc))}</span>
      <span>${escapeHtml(statusLabelAr(match.status))}</span>
      ${score}${channel}${commentator}
    </div>
  </article>`;
}

function renderMatchList(matches, teamNamesAr, emptyText = "لا توجد مباريات في هذه الصفحة حالياً.") {
  if (!matches.length) return `<div class="card"><p>${escapeHtml(emptyText)}</p></div>`;
  return `<div class="grid">${matches.map((match) => renderMatchCard(match, teamNamesAr)).join("\n")}</div>`;
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
  pushPage(
    "/matches/today",
    generatedFile("matches", "today"),
    pageShell({
      title: `مباريات اليوم ${today} — المواعيد والنتائج | ${SITE_NAME}`,
      description:
        "جدول مباريات اليوم في الدوري الإنجليزي والدوري الإسباني ودوري أبطال أوروبا مع الموعد والنتيجة والقناة والمعلّق عند توفرها.",
      canonical: "/matches/today",
      heading: "مباريات اليوم",
      lead: `جدول مباشر ومقروء لمحركات البحث لمباريات ${today}. البيانات مأخوذة من نفس جدول كورة زيرو ويتم تحديثها مع كل بناء للموقع.`,
      body: renderMatchList(todayMatches, teamNamesAr),
      schema: itemListSchema(todayMatches, siteUrl, teamNamesAr),
      siteUrl,
    }),
  );

  for (const [day, dayMatches] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const route = datePagePath(day);
    pushPage(
      route,
      generatedFile("date", day),
      pageShell({
        title: `مباريات ${day} — المواعيد والنتائج | ${SITE_NAME}`,
        description: `مواعيد ونتائج مباريات كرة القدم يوم ${day} مع القنوات والمعلّقين عند توفرهم على كورة زيرو.`,
        canonical: route,
        heading: `مباريات ${day}`,
        lead: "جدول يومي ثابت الرابط للمباريات والنتائج، مناسب للرجوع إليه ومشاركته بعد انتهاء اليوم.",
        body: renderMatchList(dayMatches, teamNamesAr),
        schema: itemListSchema(dayMatches, siteUrl, teamNamesAr),
        siteUrl,
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
        title: `مباريات ${meta.nameAr} — المواعيد والنتائج | ${SITE_NAME}`,
        description: `جدول مباريات ${meta.nameAr} القادمة والجارية والمنتهية مع الموعد والنتيجة والقناة والمعلّق عند توفرها.`,
        canonical: route,
        heading: `مباريات ${meta.nameAr}`,
        lead: `كل مباريات ${meta.nameAr} الموجودة في جدول كورة زيرو الحالي، مرتبة حسب موعد البداية.`,
        body: renderMatchList(leagueMatches, teamNamesAr),
        schema: itemListSchema(leagueMatches, siteUrl, teamNamesAr),
        siteUrl,
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
        title: `مباريات ${teamAr} — المواعيد والنتائج | ${SITE_NAME}`,
        description: `مواعيد ونتائج مباريات ${teamAr} الموجودة في جدول كورة زيرو الحالي مع البطولة والقناة والمعلّق عند توفرها.`,
        canonical: route,
        heading: `مباريات ${teamAr}`,
        lead: "تُنشأ صفحة الفريق فقط عندما يحتوي الجدول الحالي على أكثر من مباراة، لتجنب إنشاء صفحات ضعيفة أو مكررة.",
        body: renderMatchList(teamMatches, teamNamesAr),
        schema: itemListSchema(teamMatches, siteUrl, teamNamesAr),
        siteUrl,
      }),
    );
  }

  for (const match of matches) {
    const home = displayTeam(match.home, teamNamesAr);
    const away = displayTeam(match.away, teamNamesAr);
    const route = matchPagePath(match);
    const details = [
      `<p><strong>البطولة:</strong> ${escapeHtml(leagueName(match))}</p>`,
      `<p><strong>الموعد:</strong> ${escapeHtml(formatKickoffAr(match.kickoffUtc))}</p>`,
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
    const breadcrumbs = `<p class="crumbs"><a href="/matches/today">مباريات اليوم</a>${leagueUrl ? ` ← <a href="${escapeHtml(leagueUrl)}">${escapeHtml(leagueName(match))}</a>` : ""}</p>`;
    pushPage(
      route,
      generatedFile(
        "match",
        `${arabiaDayIso(match.kickoffUtc)}-${slugify(match.home)}-vs-${slugify(match.away)}`,
      ),
      pageShell({
        title: `${home} ضد ${away} — الموعد والنتيجة | ${SITE_NAME}`,
        description: `تفاصيل مباراة ${home} ضد ${away}: الموعد، الحالة، النتيجة، البطولة، القناة والمعلّق عند توفر البيانات.`,
        canonical: route,
        heading: `${home} ضد ${away}`,
        lead: `${leagueName(match)} · ${formatKickoffAr(match.kickoffUtc)} · ${statusLabelAr(match.status)}`,
        body: `${breadcrumbs}<article class="card">${details}</article>`,
        schema: sportsEventSchema(match, siteUrl, teamNamesAr),
        siteUrl,
      }),
    );
  }

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map((page) => `  <url><loc>${escapeHtml(siteUrl + page.route)}</loc><lastmod>${today}</lastmod></url>`)
    .join("\n")}\n</urlset>\n`;
  const redirectLines = pages.map((page) => `${page.route}  ${page.file}  200`);

  return { pages, sitemapXml, redirectLines, today, matchCount: matches.length };
}
