function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderTournamentArchiveLinks(index) {
  const matches = Array.isArray(index?.matches) ? index.matches : [];
  if (!matches.length) return "";
  const rows = matches
    .map((match) => {
      if (!match?.path || !match?.home || !match?.away) return "";
      const home = match.homeAr || match.home;
      const away = match.awayAr || match.away;
      const score = match.score ? ` · ${escapeHtml(match.score)}` : "";
      return `<li><a href="${escapeHtml(match.path)}">${escapeHtml(home)} ضد ${escapeHtml(away)}</a>${score}</li>`;
    })
    .filter(Boolean)
    .join("\n");
  if (!rows) return "";
  return `<section class="section seo-world-cup-archive" aria-labelledby="wc-static-archive-title">
    <details>
      <summary id="wc-static-archive-title">أرشيف كأس العالم 2026 · ${matches.length} مباراة</summary>
      <p>روابط مباشرة وثابتة لكل مباراة في الأرشيف.</p>
      <ul>${rows}</ul>
    </details>
  </section>`;
}

export function injectTournamentArchiveLinks(html, index) {
  const source = String(html || "");
  const block = renderTournamentArchiveLinks(index);
  if (!block) return source;
  const begin = "<!-- BEGIN server-rendered World Cup archive -->";
  const end = "<!-- END server-rendered World Cup archive -->";
  const wrapped = `${begin}\n${block}\n${end}`;
  const re = new RegExp(`${begin}[\\s\\S]*?${end}`);
  if (re.test(source)) return source.replace(re, wrapped);
  return source.replace("</main>", `${wrapped}\n</main>`);
}
