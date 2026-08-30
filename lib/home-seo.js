const ORGANIZATION_ALIASES = Object.freeze(["كورة صفر", "كوره صفرا", "كورازيرو", "KoraZero"]);

export function applyHomepageSeoHtml(html) {
  let out = String(html || "");
  const schemaRe = /(<script\s+type="application\/ld\+json"\s+id="seo-schema">)([\s\S]*?)(<\/script>)/i;
  out = out.replace(schemaRe, (full, open, raw, close) => {
    try {
      const schema = JSON.parse(raw);
      const graph = Array.isArray(schema?.["@graph"]) ? schema["@graph"] : [];
      const org = graph.find((node) => node?.["@type"] === "Organization");
      if (org) org.alternateName = [...ORGANIZATION_ALIASES];
      return `${open}\n  ${JSON.stringify(schema, null, 2).replace(/\n/g, "\n  ")}\n  ${close}`;
    } catch {
      return full;
    }
  });

  if (!out.includes('data-seo-home-links="true"')) {
    const links = `<section class="section" data-seo-home-links="true" aria-labelledby="seo-home-links-title">
      <div class="container">
        <h2 id="seo-home-links-title" class="section-title">روابط المباريات</h2>
        <nav class="seo-home-links" aria-label="روابط صفحات المباريات">
          <a href="/matches">مباريات اليوم</a>
          <a href="/matches/archive">أرشيف المباريات</a>
          <a href="/league/premier-league">الدوري الإنجليزي</a>
          <a href="/league/la-liga">الدوري الإسباني</a>
          <a href="/league/saudi-pro-league">الدوري السعودي</a>
          <a href="/league/champions-league">دوري أبطال أوروبا</a>
          <a href="/tournament">أرشيف كأس العالم 2026</a>
        </nav>
      </div>
    </section>`;
    out = out.replace("</main>", `${links}\n</main>`);
  }
  return out;
}

export { ORGANIZATION_ALIASES };
