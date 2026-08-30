import { buildMatchSeoHtml, w3cLastmod } from "./match-seo-page.js";
import { buildSeoPages as buildCoreSeoPages, matchPagePath } from "./seo-pages-core.js";

export * from "./seo-pages-core.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function polishGeneratedHtml(html) {
  let out = String(html || "");

  out = out
    .replace(/بتوقيت السعودية/g, "حسب توقيتك المحلي")
    .replace(/بتوقيت الرياض/g, "حسب توقيتك المحلي")
    .replace(/أدناه/g, "هنا")
    .replace(/ادناه/g, "هنا")
    .replace(
      /جدول مباشر ومقروء لمحركات البحث لمباريات ([^.]+)\. البيانات مأخوذة من نفس جدول كورة زيرو ويتم تحديثها مع كل بناء للموقع\./g,
      "مباريات $1 في مكان واحد، مع المواعيد والنتائج والقنوات والمعلّقين عند توفرها. تتحدث البيانات مع كل تحديث لجدول كورة زيرو.",
    )
    .replace(
      "جدول يومي ثابت الرابط للمباريات والنتائج، مناسب للرجوع إليه ومشاركته بعد انتهاء اليوم.",
      "مواعيد ونتائج مباريات هذا اليوم في صفحة واحدة، مع تفاصيل المباراة المتاحة للرجوع إليها بسهولة.",
    )
    .replace(
      /كل مباريات ([^<]+) الموجودة في جدول كورة زيرو الحالي، مرتبة حسب موعد البداية\./g,
      "مواعيد ونتائج مباريات $1 مرتبة حسب وقت البداية، مع القنوات والمعلّقين عند توفر البيانات.",
    )
    .replace(
      "تُنشأ صفحة الفريق فقط عندما يحتوي الجدول الحالي على أكثر من مباراة، لتجنب إنشاء صفحات ضعيفة أو مكررة.",
      "مواعيد ونتائج مباريات الفريق الظاهرة في جدول كورة زيرو، مرتبة زمنياً مع تفاصيل كل مباراة.",
    )
    .replace(
      "هذه الصفحات تُنشأ تلقائياً من نفس بيانات المباريات الظاهرة في كورة زيرو، لتكون المواعيد والنتائج والقنوات والمعلّقون قابلة للقراءة مباشرةً بدون الاعتماد على JavaScript.",
      "بيانات المباريات على كورة زيرو تتحدث تلقائياً وتشمل المواعيد والنتائج والقنوات والمعلّقين عند توفرها.",
    )
    .replace('<a href="/world-cup-2026">كأس العالم 2026</a>', '<a href="/tournament">كأس العالم 2026</a>')
    .replace(
      '<a href="/tournament">أرشيف الملخصات</a>',
      '<a href="/highlights.html">ملخصات الموسم</a><a href="/tournament">كأس العالم 2026</a>',
    );

  out = out
    .replace(
      ':root{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;color:#101828;background:#f5f7fb}',
      ':root{color-scheme:dark;font-family:system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;color:#f4f7fb;background:#060914}',
    )
    .replace(
      "*{box-sizing:border-box}body{margin:0}",
      "*{box-sizing:border-box}body{margin:0;background:radial-gradient(850px 420px at 95% -10%,rgba(139,92,246,.15),transparent 58%),radial-gradient(700px 380px at 0 10%,rgba(24,226,154,.1),transparent 55%),#060914;color:#f4f7fb}",
    )
    .replace(/color:#101828/g, "color:#f4f7fb")
    .replace(/color:#344054/g, "color:#cbd5e1")
    .replace(/color:#475467/g, "color:#aab6c7")
    .replace(/color:#667085/g, "color:#94a3b8")
    .replace(/background:#fff/g, "background:#101827")
    .replace(/border:1px solid #e4e7ec/g, "border:1px solid rgba(255,255,255,.09)")
    .replace("box-shadow:0 8px 28px rgba(16,24,40,.05)", "box-shadow:0 18px 48px rgba(0,0,0,.3)");

  if (!out.includes("/assets/js/seo-local-time.js")) {
    out = out.replace(
      "</body>",
      '  <script src="/assets/js/seo-local-time.js?v=20260829"></script>\n</body>',
    );
  }

  return out;
}

function addArchiveLink(html) {
  if (String(html).includes('href="/matches/archive"')) return html;
  return String(html).replace("</nav>", '<a href="/matches/archive">أرشيف المباريات</a></nav>');
}

function archiveHtml(matches, siteUrl, teamNamesAr) {
  const ended = matches
    .filter((match) => match?.status === "ended" && matchPagePath(match))
    .sort((a, b) => Date.parse(b.kickoffUtc || "") - Date.parse(a.kickoffUtc || ""));
  const rows = ended
    .map((match) => {
      const home = teamNamesAr?.[match.home] || match.home;
      const away = teamNamesAr?.[match.away] || match.away;
      const day = String(match.kickoffUtc || "").slice(0, 10);
      const score = match.score && match.score !== "VS" ? ` · ${escapeHtml(match.score)}` : "";
      return `<li><a href="${escapeHtml(matchPagePath(match))}">${escapeHtml(home)} ضد ${escapeHtml(away)}</a><span> · ${escapeHtml(day)}${score}</span></li>`;
    })
    .join("\n");
  const description =
    "أرشيف مباريات كورة زيرو المنتهية مع روابط ثابتة لصفحة كل مباراة والنتيجة والتفاصيل المتاحة.";
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>أرشيف المباريات والنتائج | كورة زيرو</title>
  <meta name="description" content="${description}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
  <link rel="canonical" href="${siteUrl}/matches/archive">
  <link rel="stylesheet" href="/assets/css/seo-pages.css?v=20260829">
</head>
<body>
  <main class="seo-wrap">
    <header class="seo-top">
      <a class="seo-brand" href="/">Kora<b>Zero</b> · كورة زيرو</a>
      <nav class="seo-nav" aria-label="روابط رئيسية"><a href="/matches">مباريات اليوم</a><a href="/tournament">كأس العالم 2026</a></nav>
    </header>
    <section class="seo-hero"><span class="seo-kicker">أرشيف دائم</span><h1>أرشيف المباريات والنتائج</h1><p class="seo-lead">كل مباراة منتهية نحتفظ لها برابط ثابت بدلاً من حذف الصفحة بعد صافرة النهاية.</p></section>
    <section class="seo-section"><div class="seo-section-head"><h2>المباريات المنتهية</h2></div>${rows ? `<ul class="seo-detail">${rows}</ul>` : '<div class="seo-empty"><p>لا توجد مباريات منتهية محفوظة بعد.</p></div>'}</section>
  </main>
</body>
</html>`;
}

function fileForEnglishMatch(file) {
  return String(file).replace("/generated/seo/match-", "/generated/seo/en-match-");
}

function buildScheduleSitemap(pages, matchByRoute, siteUrl) {
  const base = String(siteUrl || "https://korazero.com").replace(/\/$/, "");
  const rows = [];
  const seen = new Set();
  for (const page of pages) {
    if (!page?.route || seen.has(page.route)) continue;
    seen.add(page.route);
    const arRoute = page.route.replace(/^\/en(?=\/match\/)/, "");
    const match = matchByRoute.get(arRoute);
    const lastmod = match?.seoLastmod ? w3cLastmod(match.seoLastmod) : "";
    rows.push(
      `  <url><loc>${escapeHtml(base + page.route)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`,
    );
  }
  rows.push(`  <url><loc>${base}/highlights.html</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
}

export function buildSeoPages(payload, options = {}) {
  const siteUrl = String(options.siteUrl || "https://korazero.com").replace(/\/$/, "");
  const teamNamesAr = options.teamNamesAr || {};
  const archived =
    Array.isArray(payload?.seoMatches) && payload.seoMatches.length
      ? payload.seoMatches
      : payload?.matches || [];
  const sourceMatches = archived.filter((match) => match?.home && match?.away && matchPagePath(match));
  const corePayload = { ...payload, matches: sourceMatches };
  const result = buildCoreSeoPages(corePayload, options);
  const matchByRoute = new Map(sourceMatches.map((match) => [matchPagePath(match), match]));
  const pages = [];

  for (const page of result.pages) {
    const match = matchByRoute.get(page.route);
    if (match) {
      pages.push({
        ...page,
        html: buildMatchSeoHtml({
          match,
          route: page.route,
          siteUrl,
          teamNamesAr,
          lang: "ar",
          payloadDate: payload?.date || "",
        }),
      });
      pages.push({
        route: `/en${page.route}`,
        file: fileForEnglishMatch(page.file),
        html: buildMatchSeoHtml({
          match,
          route: `/en${page.route}`,
          siteUrl,
          teamNamesAr,
          lang: "en",
          payloadDate: payload?.date || "",
        }),
      });
      continue;
    }

    const polished = polishGeneratedHtml(page.html);
    pages.push({ ...page, html: page.route === "/matches" ? addArchiveLink(polished) : polished });
  }

  pages.push({
    route: "/matches/archive",
    file: "/generated/seo/matches-archive.html",
    html: archiveHtml(sourceMatches, siteUrl, teamNamesAr),
  });

  const redirectLines = [
    ...new Set([...pages.map((page) => `${page.route}  ${page.file}  200`), "/matches/today  /matches  301"]),
  ];

  return {
    ...result,
    pages,
    redirectLines,
    sitemapXml: buildScheduleSitemap(pages, matchByRoute, siteUrl),
    matchCount: sourceMatches.length,
  };
}
