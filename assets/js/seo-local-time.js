(() => {
  const cards = [...document.querySelectorAll(".seo-card")];
  if (!cards.length) return;

  function slugify(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");
  }

  function riyadhDayIso(utcIso) {
    const ms = Date.parse(utcIso || "");
    if (Number.isNaN(ms)) return "";
    return new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);
  }

  function matchPath(match) {
    const day = riyadhDayIso(match?.kickoffUtc);
    const teams = [slugify(match?.home), slugify(match?.away)].filter(Boolean).join("-vs-");
    return day && teams ? `/match/${day}/${teams}` : "";
  }

  function localKickoff(utcIso) {
    const ms = Date.parse(utcIso || "");
    if (Number.isNaN(ms)) return "";
    return new Intl.DateTimeFormat("ar", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(ms));
  }

  fetch("/assets/data/today.json", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      const matches = Array.isArray(payload?.matches) ? payload.matches : [];
      if (!matches.length) return;

      const byPath = new Map(matches.map((match) => [matchPath(match), match]));
      for (const card of cards) {
        const link = card.querySelector('.seo-match-link[href^="/match/"]');
        if (!link) continue;
        const path = new URL(link.href, location.origin).pathname;
        const match = byPath.get(path);
        const meta = card.querySelector(".seo-meta");
        const kickoffNode = meta?.children?.[1];
        if (!match?.kickoffUtc || !kickoffNode) continue;
        const value = localKickoff(match.kickoffUtc);
        if (value) {
          kickoffNode.textContent = value;
          kickoffNode.dataset.localTime = "true";
        }
      }

      const currentMatch = byPath.get(location.pathname);
      if (!currentMatch?.kickoffUtc) return;
      const local = localKickoff(currentMatch.kickoffUtc);
      const detailTime = document.querySelector(".seo-detail p:nth-child(2)");
      if (detailTime && local) detailTime.innerHTML = `<strong>الموعد:</strong> ${local} · حسب توقيت جهازك`;

      const lead = document.querySelector(".seo-lead");
      if (lead && local) {
        const parts = lead.textContent.split("·").map((part) => part.trim()).filter(Boolean);
        if (parts.length >= 2) {
          const first = parts[0];
          const last = parts.at(-1);
          lead.textContent = `${first} · ${local} · ${last}`;
        }
      }
    })
    .catch(() => {});
})();
