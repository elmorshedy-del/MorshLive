/* Shared routing override helpers (admin + watch). */
(function () {
  const EMPTY = { embedBinding: {}, matchOverrides: {}, updatedAt: null, source: null };

  function mergeBindings(base, overrides) {
    const baseMap = (base && base.embedBinding) || base || {};
    const overMap = (overrides && overrides.embedBinding) || {};
    return { ...baseMap, ...overMap };
  }

  function effectiveEmbedKey(channelId, match, bindings, matchOverrides) {
    const mo = matchOverrides || {};
    if (match && match.id && mo[match.id]) return mo[match.id];
    if (match && match.embedKey) return match.embedKey;
    const map = bindings || {};
    return map[channelId] || "vip1";
  }

  function buildRouteRows(matches, baseBindings, overrides) {
    const over = overrides || EMPTY;
    const bindingMap = mergeBindings(baseBindings, over);
    const mo = over.matchOverrides || {};

    const routes = (matches || []).map((m) => {
      const embedKey = effectiveEmbedKey(m.channelId, m, bindingMap, mo);
      return {
        id: m.id,
        home: m.home,
        away: m.away,
        status: m.status,
        score: m.score,
        minute: m.minute || "",
        channelId: m.channelId || null,
        channel: m.channel || null,
        commentator: m.commentator || null,
        embedKey,
        kickoffUtc: m.kickoffUtc || null,
        hasOverride: !!(m.id && mo[m.id]),
      };
    });

    const byEmbed = {};
    routes.filter((r) => r.status === "live").forEach((r) => {
      if (!byEmbed[r.embedKey]) byEmbed[r.embedKey] = [];
      byEmbed[r.embedKey].push(`${r.home} vs ${r.away} (${r.channelId || "?"})`);
    });

    const conflicts = Object.entries(byEmbed)
      .filter(([, games]) => games.length > 1)
      .map(([embed, games]) => ({ embed, games }));

    return { routes, conflicts, ok: conflicts.length === 0 };
  }

  window.KZ_ROUTING = {
    EMPTY,
    mergeBindings,
    effectiveEmbedKey,
    buildRouteRows,
  };
})();
