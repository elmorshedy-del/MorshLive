import { buildSeoPages as buildCoreSeoPages } from "./seo-pages-core.js";

export * from "./seo-pages-core.js";

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

function includeStaticDiscoverability(sitemapXml, siteUrl) {
  const base = String(siteUrl || "https://korazero.com").replace(/\/$/, "");
  const row = `  <url><loc>${base}/highlights.html</loc></url>`;
  if (String(sitemapXml).includes(`${base}/highlights.html`)) return sitemapXml;
  return String(sitemapXml).replace("</urlset>", `${row}\n</urlset>`);
}

export function buildSeoPages(payload, options = {}) {
  const result = buildCoreSeoPages(payload, options);
  return {
    ...result,
    sitemapXml: includeStaticDiscoverability(result.sitemapXml, options.siteUrl),
    pages: result.pages.map((page) => ({ ...page, html: polishGeneratedHtml(page.html) })),
  };
}
