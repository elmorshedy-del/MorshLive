import { renderTournamentSeoDocument } from "../services/tournament-seo.js";

export const tournamentSeoRoute = {
  name: "tournament-seo",
  methods: ["GET"],
  test: (url) => url.pathname === "/tournament" || url.pathname === "/tournament.html",
  async handle({ env, url }) {
    const html = await renderTournamentSeoDocument(env, url.origin);
    if (!html) return null;
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=3600",
        "Content-Language": "ar",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
};
