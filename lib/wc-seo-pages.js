// Pre-renders the World Cup match and team pages.
//
// Both routes are rewrites: `_redirects` maps /world-cup-2026/<slug> onto a
// single static shell, so every one of the 152 URLs used to ship the same
// <title>, the same <h1> and a canonical pointing at /world-cup-2026/ — a URL
// that 404s. A canonical to a missing page tells a crawler not to index the
// page it is on, which is why Googlebot stopped fetching these.
//
// The shell still hydrates in the browser; this only bakes the same values the
// client already computes into the served HTML, so a crawler reading raw HTML
// and a person running the JS agree.

const SITE = "https://korazero.com";

const STAGE_AR = Object.freeze({
  "group-stage": "دور المجموعات",
  "round-of-32": "دور الـ32",
  "round-of-16": "دور الـ16",
  quarterfinals: "ربع النهائي",
  semifinals: "نصف النهائي",
  "3rd-place-match": "مباراة المركز الثالث",
  final: "النهائي",
});

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Replace the first attribute value on a tag matched by a unique marker. */
function setAttr(html, marker, attr, value) {
  const re = new RegExp(`(${marker}[^>]*?\\b${attr}=")[^"]*(")`);
  return html.replace(re, `$1${escapeHtml(value)}$2`);
}

function setText(html, idAttr, value) {
  const re = new RegExp(`(<[^>]*\\bid="${idAttr}"[^>]*>)[\\s\\S]*?(</[a-z0-9]+>)`, "i");
  return html.replace(re, `$1${escapeHtml(value)}$2`);
}

function arabicDay(kickoffUtc) {
  const ms = Date.parse(kickoffUtc || "");
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

/** Title, description and heading, matching what `tournament.js` sets at runtime. */
export function wcMatchMeta(match) {
  const home = match?.homeAr || match?.home || "";
  const away = match?.awayAr || match?.away || "";
  const heading = `ملخص مباراة ${home} و${away} في كأس العالم 2026`;
  return {
    path: `/world-cup-2026/${match?.slug || ""}`,
    title: `${heading} | كورة زيرو`,
    ogTitle: heading,
    heading,
    description: `ملخص مباراة ${home} و${away} في كأس العالم 2026 — فيديو الأهداف والملخص الكامل على كورة زيرو.`,
    lede: `ملخص عربي، فيديو الأهداف، والملخص الكامل لمباراة ${home} و${away}.`,
  };
}

export function wcTeamMeta(team) {
  const name = team?.nameAr || team?.name || "";
  const heading = `ملخصات مباريات ${name} في كأس العالم 2026`;
  return {
    path: `/world-cup-2026/${team?.slug || ""}`,
    title: `${heading} | كورة زيرو`,
    ogTitle: heading,
    heading,
    description: `كل مباريات ${name} في كأس العالم 2026 — ملخصات عربية وفيديو الأهداف والملخص الكامل لكل مباراة على كورة زيرو.`,
    lede: `كل مباريات ${name} في المونديال — ملخص عربي، فيديو الأهداف، وملخص كامل لكل مباراة.`,
  };
}

/**
 * Content a crawler can read without running the page's JavaScript. Hidden from
 * people the moment `tournament.js` renders the live card, so nothing shows twice.
 */
function matchPrerender(match, detail) {
  const home = escapeHtml(match.homeAr || match.home);
  const away = escapeHtml(match.awayAr || match.away);
  const day = arabicDay(match.kickoffUtc);
  const stage = STAGE_AR[match.stage] || "";
  const score = match.score && match.score !== "VS" ? escapeHtml(match.score) : "";

  const facts = [
    score && `<li><b>النتيجة</b><span>${home} ${score} ${away}</span></li>`,
    day && `<li><b>التاريخ</b><span>${escapeHtml(day)}</span></li>`,
    stage && `<li><b>الدور</b><span>${escapeHtml(stage)}</span></li>`,
    detail?.venue && `<li><b>الملعب</b><span>${escapeHtml(detail.venue)}</span></li>`,
  ]
    .filter(Boolean)
    .join("");

  const goals = (detail?.goals || [])
    .map((goal) => {
      const side = goal.side === "away" ? away : home;
      const note = goal.penalty ? " (ركلة جزاء)" : goal.own ? " (هدف عكسي)" : "";
      return `<li>${escapeHtml(goal.minute || "")} — ${escapeHtml(goal.scorer || "")}${escapeHtml(note)} · ${side}</li>`;
    })
    .join("");

  const summary = detail?.summaryAr ? `<p>${escapeHtml(detail.summaryAr)}</p>` : "";

  return `<section class="wc-prerender" id="wc-prerender">
        ${summary}
        ${facts ? `<ul class="wc-prerender-facts">${facts}</ul>` : ""}
        ${goals ? `<h2>الأهداف</h2><ul class="wc-prerender-goals">${goals}</ul>` : ""}
      </section>`;
}

function teamPrerender(team, matches) {
  const name = escapeHtml(team.nameAr || team.name);
  const rows = matches
    .map((match) => {
      const home = escapeHtml(match.homeAr || match.home);
      const away = escapeHtml(match.awayAr || match.away);
      const score = match.score && match.score !== "VS" ? ` · ${escapeHtml(match.score)}` : "";
      const day = arabicDay(match.kickoffUtc);
      return `<li><a href="${escapeHtml(`/world-cup-2026/${match.slug}`)}">${home} ضد ${away}</a><span> · ${escapeHtml(day)}${score}</span></li>`;
    })
    .join("");
  return `<section class="wc-prerender" id="wc-prerender">
        <p>كل مباريات ${name} في كأس العالم 2026، مع النتيجة ورابط ملخص كل مباراة.</p>
        ${rows ? `<ul class="wc-prerender-list">${rows}</ul>` : ""}
      </section>`;
}

function sportsEventJsonLd(match, meta, detail) {
  const data = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `${match.homeAr || match.home} ضد ${match.awayAr || match.away}`,
    url: SITE + meta.path,
    sport: "Soccer",
    startDate: match.kickoffUtc || undefined,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    superEvent: { "@type": "SportsEvent", name: "FIFA World Cup 2026" },
    competitor: [
      { "@type": "SportsTeam", name: match.home },
      { "@type": "SportsTeam", name: match.away },
    ],
  };
  if (detail?.venue) data.location = { "@type": "Place", name: detail.venue };
  // JSON-LD sits in a script block, so `<` is the only character that can break out.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

function applyMeta(shell, meta, extraHead, prerender) {
  let out = shell;
  const canonical = SITE + meta.path;

  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(meta.title)}</title>`);
  out = setAttr(out, '<meta name="description"', "content", meta.description);
  out = setAttr(out, '<link rel="canonical"', "href", canonical);
  out = setAttr(out, '<meta property="og:title"', "content", meta.ogTitle);
  out = setAttr(out, '<meta property="og:url"', "content", canonical);

  if (extraHead) out = out.replace("</head>", `  ${extraHead}\n</head>`);

  out = setText(out, "wc-match-title", meta.heading);
  out = setText(out, "wc-team-title", meta.heading);
  out = setText(out, "wc-match-lede", meta.lede);
  out = setText(out, "wc-team-lede", meta.lede);

  // Ahead of the JS-driven containers so the readable copy comes first in the DOM.
  out = out.replace(
    '<section class="tournament-featured"',
    `${prerender}\n      <section class="tournament-featured"`,
  );
  return out;
}

export function renderWcMatchPage({ shell, match, detail }) {
  const meta = wcMatchMeta(match);
  return applyMeta(shell, meta, sportsEventJsonLd(match, meta, detail), matchPrerender(match, detail));
}

export function renderWcTeamPage({ shell, team, matches }) {
  const meta = wcTeamMeta(team);
  return applyMeta(shell, meta, "", teamPrerender(team, matches));
}

/** Matches a team played, newest first, from the match index. */
export function matchesForTeam(team, matches) {
  return matches
    .filter((match) => match.home === team.name || match.away === team.name)
    .sort((a, b) => Date.parse(b.kickoffUtc || "") - Date.parse(a.kickoffUtc || ""));
}

export function buildWcSitemap(entries, { lastmod = "" } = {}) {
  const rows = entries
    .map((entry) => {
      const loc = escapeHtml(SITE + `/world-cup-2026/${entry.slug}`);
      return `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${escapeHtml(lastmod)}</lastmod>` : ""}</url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</urlset>\n`;
}

/**
 * `_redirects` rewrite lines. The `?slug=` / `?team=` query is kept so the
 * client keeps resolving the page exactly as it does today.
 */
export function buildWcRedirectLines(matches, teams) {
  const lines = [];
  for (const team of teams) {
    lines.push(
      `/world-cup-2026/${team.slug}  /generated/seo/wc/team-${team.slug}.html?team=${team.slug}  200`,
    );
  }
  for (const match of matches) {
    lines.push(
      `/world-cup-2026/${match.slug}  /generated/seo/wc/match-${match.slug}.html?slug=${match.slug}  200`,
    );
  }
  return lines;
}

export { STAGE_AR };
