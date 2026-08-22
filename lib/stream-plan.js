/**
 * Match-scoped stream plans — deterministic source selection.
 *
 * Plans are per match, not per channel. A source may play only when it shares
 * the plan content key. Provider profiles freeze sandbox/referrer so those
 * settings stop being guessed per hotfix.
 */

export const STREAM_PLAN_VERSION = 1;

export const SOURCE_STATUSES = Object.freeze(["verified", "operator", "pending", "failed"]);

export const PLAN_STATUSES = Object.freeze([
  "verified",
  "operator",
  "pending",
  "waiting",
  "legacy",
  "conflict",
]);

export const STATUS_RANK = Object.freeze({
  verified: 4,
  operator: 3,
  pending: 2,
  failed: 0,
});

export const PROVIDER_PROFILES = Object.freeze({
  "koraplus-v1": {
    id: "koraplus-v1",
    provider: "koraplus",
    kind: "iframe",
    sandbox: "none",
    referrerPolicy: "no-referrer",
    notes: "go4score/frame.php must stay unsandboxed on iOS Safari",
  },
  "kooracity-v1": {
    id: "kooracity-v1",
    provider: "kooracity",
    kind: "iframe",
    sandbox: "none",
    referrerPolicy: "no-referrer",
    notes: "Nested player wrappers break inside an outer sandbox",
  },
  "sirtv-v1": {
    id: "sirtv-v1",
    provider: "sirtv",
    kind: "iframe",
    sandbox: "allow-scripts allow-same-origin allow-presentation allow-forms",
    referrerPolicy: "no-referrer",
    notes: "Same-origin worker proxy; keep a tight sandbox",
  },
  "ntv-v1": {
    id: "ntv-v1",
    provider: "ntv",
    kind: "iframe",
    sandbox: "none",
    referrerPolicy: "no-referrer",
    notes: "NTV loaders create descendant frames that inherit sandbox",
  },
  "hls-direct-v1": {
    id: "hls-direct-v1",
    provider: "hls",
    kind: "hls",
    sandbox: null,
    referrerPolicy: "no-referrer",
    notes: "Same-origin or CORS HLS in a <video> element",
  },
  "xtream-v1": {
    id: "xtream-v1",
    provider: "xtream",
    kind: "xtream",
    sandbox: null,
    referrerPolicy: "no-referrer",
    notes: "Portal credentials stay in Wrangler secrets, never in the plan",
  },
  "operator-iframe-v1": {
    id: "operator-iframe-v1",
    provider: "operator",
    kind: "iframe",
    sandbox: "none",
    referrerPolicy: "no-referrer",
    notes: "Default for a pasted embed. Prefer no sandbox until a host is proven",
  },
  "operator-hls-v1": {
    id: "operator-hls-v1",
    provider: "operator",
    kind: "hls",
    sandbox: null,
    referrerPolicy: "no-referrer",
    notes: "Pasted HLS/m3u8. Same-content fallbackUrl only",
  },
});

export const DEFAULT_PROFILE_BY_KIND = Object.freeze({
  iframe: "operator-iframe-v1",
  hls: "operator-hls-v1",
  xtream: "xtream-v1",
});

const LEGACY_PROFILES = Object.freeze({
  koraplus: "koraplus-v1",
  kooracity: "kooracity-v1",
  sirtv: "sirtv-v1",
  ntv: "ntv-v1",
});

const KINDS = new Set(["iframe", "hls", "xtream"]);
const ROLES = new Set(["primary", "alternate"]);

export function emptyCatalog() {
  return { version: STREAM_PLAN_VERSION, updatedAt: null, plans: [] };
}

function catalogHasPlans(catalog) {
  return Boolean(catalog && Array.isArray(catalog.plans) && catalog.plans.length);
}

function catalogUpdatedAtMs(catalog) {
  const ms = Date.parse(String(catalog?.updatedAt || ""));
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * ASSETS wins unless the bundled catalog is strictly newer by updatedAt.
 * A missing timestamp on ASSETS is treated as current — do not replace a
 * filled live file with the worker bundle. Empty catalogs never win.
 */
export function preferNewerCatalog(asset, bundled) {
  const assetOk = catalogHasPlans(asset);
  const bundledOk = catalogHasPlans(bundled);
  if (assetOk && bundledOk) {
    const assetMs = catalogUpdatedAtMs(asset);
    const bundledMs = catalogUpdatedAtMs(bundled);
    if (assetMs && bundledMs && bundledMs > assetMs) return bundled;
    return asset;
  }
  if (assetOk) return asset;
  if (bundledOk) return bundled;
  return emptyCatalog();
}

export function normalizeTeamName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchPlanKey(home, away) {
  return [normalizeTeamName(home), normalizeTeamName(away)].filter(Boolean).sort().join("~");
}

export function contentKeyForMatch(match) {
  if (!match) return "";
  if (match.contentKey) return String(match.contentKey);
  if (match.channelId) return `channel:${match.channelId}`;
  if (match.id) return `match:${match.id}`;
  return "";
}

function teamSpecMatches(spec, name) {
  const wanted = normalizeTeamName(name);
  if (Array.isArray(spec)) return spec.some((alias) => normalizeTeamName(alias) === wanted);
  return normalizeTeamName(spec) === wanted;
}

export function teamsMatchPlan(plan, match) {
  if (!plan || !match) return false;
  const teams = plan.teams;
  if (!Array.isArray(teams) || teams.length < 2) return false;
  const [left, right] = teams;
  return (
    (teamSpecMatches(left, match.home) && teamSpecMatches(right, match.away)) ||
    (teamSpecMatches(left, match.away) && teamSpecMatches(right, match.home))
  );
}

export function findCatalogPlan(catalog, match) {
  const plans = Array.isArray(catalog?.plans) ? catalog.plans : [];
  if (!match) return null;
  if (match.id) {
    const exact = plans.find((plan) => String(plan.matchId || "") === String(match.id));
    if (exact) return exact;
  }
  return plans.find((plan) => teamsMatchPlan(plan, match)) || null;
}

export function allowlistedHref(value) {
  const href = String(value || "").trim();
  if (!href) return "";
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  try {
    const parsed = new URL(href);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    if (parsed.username || parsed.password) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function inferKind(raw) {
  if (raw.portalId && raw.streamId) return "xtream";
  const href = String(raw.url || raw.path || "");
  if (/\.m3u8(\?|$)/i.test(href) || raw.kind === "hls") return "hls";
  return "iframe";
}

export function effectiveSourceStatus(source, now = Date.now()) {
  const status = SOURCE_STATUSES.includes(source?.status) ? source.status : "pending";
  if (status === "failed") return "failed";
  if (source?.expiresAt) {
    const expires = Date.parse(source.expiresAt);
    if (Number.isFinite(expires) && expires <= now) return "pending";
  }
  return status;
}

export function iframePolicyForProfile(profileId) {
  const profile = PROVIDER_PROFILES[profileId] || PROVIDER_PROFILES["operator-iframe-v1"];
  const noSandbox = profile.sandbox === "none" || profile.sandbox == null;
  return {
    profileId: profile.id,
    kind: profile.kind,
    provider: profile.provider,
    noSandbox,
    sandbox: noSandbox ? "" : profile.sandbox,
    referrerPolicy: profile.referrerPolicy || "no-referrer",
    notes: profile.notes || "",
  };
}

function defaultPolicy(overrides = {}) {
  return {
    sameContentOnly: true,
    allowAutoHeal: false,
    allowUnverifiedFallback: false,
    allowLegacy: overrides.allowLegacy ?? true,
    ...overrides,
  };
}

export function normalizeSource(raw, planContentKey = "", now = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const kind = KINDS.has(raw.kind) ? raw.kind : inferKind(raw);
  const profile = PROVIDER_PROFILES[raw.profile] ? raw.profile : DEFAULT_PROFILE_BY_KIND[kind];
  const contentKey = String(raw.contentKey || planContentKey || "");
  const url = allowlistedHref(raw.url);
  const path = allowlistedHref(raw.path);
  const fallbackUrl = allowlistedHref(raw.fallbackUrl);
  const portalId = String(raw.portalId || "").replace(/[^a-z0-9_-]/gi, "");
  const streamId = String(raw.streamId || "").replace(/[^a-z0-9_-]/gi, "");
  if (kind === "xtream") {
    if (!portalId || !streamId) return null;
  } else if (!url && !path) {
    return null;
  }
  const source = {
    id: String(raw.id || `${kind}-${profile}`),
    role: ROLES.has(raw.role) ? raw.role : "alternate",
    kind,
    profile,
    url,
    path,
    fallbackUrl,
    portalId,
    streamId,
    contentKey,
    status: SOURCE_STATUSES.includes(raw.status) ? raw.status : "pending",
    verifiedAt: raw.verifiedAt || null,
    expiresAt: raw.expiresAt || null,
    label: String(raw.label || ""),
    note: String(raw.note || ""),
  };
  source.effectiveStatus = effectiveSourceStatus(source, now);
  return source;
}

export function normalizePlan(raw, match = null, now = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const contentKey = String(raw.contentKey || contentKeyForMatch(match) || "");
  const sources = (Array.isArray(raw.sources) ? raw.sources : [])
    .map((source) => normalizeSource(source, contentKey, now))
    .filter(Boolean);
  return {
    version: Number(raw.version) || STREAM_PLAN_VERSION,
    matchId: String(raw.matchId || match?.id || ""),
    teams: Array.isArray(raw.teams) ? raw.teams : [],
    contentKey,
    kickoffUtc: raw.kickoffUtc || match?.kickoffUtc || null,
    status: PLAN_STATUSES.includes(raw.status) ? raw.status : "pending",
    verifiedAt: raw.verifiedAt || null,
    expiresAt: raw.expiresAt || null,
    sources,
    policy: defaultPolicy(raw.policy || {}),
  };
}

export function sameContentSources(plan) {
  if (!plan) return [];
  if (!plan.policy?.sameContentOnly) return plan.sources.slice();
  return plan.sources.filter((source) => !plan.contentKey || source.contentKey === plan.contentKey);
}

function sourceRank(source, now) {
  const status = effectiveSourceStatus(source, now);
  const statusRank = STATUS_RANK[status] || 0;
  const roleRank = source.role === "primary" ? 1 : 0;
  return statusRank * 10 + roleRank;
}

export function selectPlayableSource(plan, options = {}) {
  if (!plan) return null;
  const now = options.now ?? Date.now();
  const allowFailed = options.allowFailed === true;
  const allowUnverified = options.allowUnverified === true || plan.policy?.allowUnverifiedFallback === true;
  const candidates = sameContentSources(plan).filter((source) => {
    const status = effectiveSourceStatus(source, now);
    if (status === "failed") return allowFailed;
    if (status === "pending") return allowUnverified;
    return status === "verified" || status === "operator";
  });
  if (!candidates.length) return null;
  return candidates.slice().sort((left, right) => sourceRank(right, now) - sourceRank(left, now))[0];
}

export function playbackUrlForSource(source, context = {}) {
  if (!source) return "";
  if (source.kind === "xtream") {
    const origin = context.origin || "";
    const params = new URLSearchParams({
      source: "xtream",
      portal: source.portalId,
      stream: source.streamId,
    });
    return `${origin}/watch.html?${params.toString()}`;
  }
  if (source.url) return source.url;
  if (source.path) {
    const origin = context.origin || "https://korazero.com";
    const url = new URL(source.path, origin);
    if (context.match?.channelId) url.searchParams.set("ch", context.match.channelId);
    if (context.match?.id) url.searchParams.set("match", context.match.id);
    if (context.match?.home) url.searchParams.set("home", context.match.home);
    if (context.match?.away) url.searchParams.set("away", context.match.away);
    if (!context.origin) return `${url.pathname}${url.search}`;
    return url.toString();
  }
  return "";
}

export function buildLegacyPlan(match, embedKey = "", now = Date.now()) {
  const key = String(embedKey || match?.embedKey || "koraplus");
  const profile = LEGACY_PROFILES[key] || "koraplus-v1";
  const contentKey = contentKeyForMatch(match);
  return normalizePlan(
    {
      matchId: match?.id || "",
      contentKey,
      status: "legacy",
      policy: {
        sameContentOnly: true,
        allowAutoHeal: false,
        allowUnverifiedFallback: true,
        allowLegacy: true,
      },
      sources: [
        {
          id: `legacy-${key}`,
          role: "primary",
          kind: "iframe",
          profile,
          path: `/wk/albaplayer/${key}/`,
          contentKey,
          status: "pending",
          label: key,
        },
      ],
    },
    match,
    now,
  );
}

function resolvedView({ match, plan, selected, status, reason, catalog }) {
  const profile = selected ? iframePolicyForProfile(selected.profile) : null;
  return {
    version: STREAM_PLAN_VERSION,
    matchId: match?.id || plan?.matchId || "",
    contentKey: plan?.contentKey || contentKeyForMatch(match),
    status,
    selected: selected
      ? {
          ...selected,
          playbackUrl: playbackUrlForSource(selected, { match, origin: "" }),
        }
      : null,
    alternates: sameContentSources(plan).filter((source) => source.id !== selected?.id),
    policy: {
      ...(plan?.policy || defaultPolicy()),
      sandbox: profile?.sandbox || "",
      noSandbox: profile ? profile.noSandbox : true,
      referrerPolicy: profile?.referrerPolicy || "no-referrer",
      allowAutoHeal: plan?.policy?.allowAutoHeal === true,
    },
    profile,
    reason,
    catalog: Boolean(catalog),
  };
}

export function resolveStreamPlan({ match, catalog, legacyEmbedKey = "", now = Date.now() } = {}) {
  if (!match?.id) {
    return resolvedView({
      match,
      plan: normalizePlan({ policy: { allowLegacy: false } }, match, now),
      selected: null,
      status: "waiting",
      reason: "missing-match",
      catalog: false,
    });
  }

  const found = findCatalogPlan(catalog, match);
  if (found) {
    const plan = normalizePlan(found, match, now);
    const selected = selectPlayableSource(plan, { now });
    if (selected) {
      const status = effectiveSourceStatus(selected, now);
      return resolvedView({
        match,
        plan,
        selected,
        status: status === "pending" ? "pending" : status,
        reason: `selected:${selected.id}`,
        catalog: true,
      });
    }
    if (!plan.policy.allowLegacy) {
      return resolvedView({
        match,
        plan,
        selected: null,
        status: "waiting",
        reason: "no-playable-same-content-source",
        catalog: true,
      });
    }
  }

  const legacy = buildLegacyPlan(match, legacyEmbedKey || match.embedKey, now);
  const selected = selectPlayableSource(legacy, { now, allowUnverified: true });
  return resolvedView({
    match,
    plan: legacy,
    selected,
    status: "legacy",
    reason: found ? "catalog-empty-legacy" : "no-catalog-legacy",
    catalog: false,
  });
}

export function liveContentConflicts(liveMatches, catalog, now = Date.now()) {
  const rows = (liveMatches || []).map((match) => resolveStreamPlan({ match, catalog, now }));
  const byKey = new Map();
  for (const plan of rows) {
    const key = plan.selected?.contentKey || "";
    if (!key || !plan.selected || !plan.catalog) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(plan.matchId);
  }
  return [...byKey.entries()]
    .filter(([, matchIds]) => matchIds.length > 1)
    .map(([contentKey, matchIds]) => ({ contentKey, matchIds }));
}

export function applyConflicts(plan, conflicts) {
  if (!plan) return plan;
  const hit = (conflicts || []).find((row) => row.matchIds.includes(plan.matchId));
  if (!hit || !plan.catalog) return { ...plan, conflict: null };
  return {
    ...plan,
    status: "conflict",
    selected: null,
    reason: "shared-content-key",
    conflict: hit,
  };
}

export function applyVerificationResult(plan, result = {}, now = Date.now()) {
  const normalized = normalizePlan(plan, null, now);
  if (!normalized) return null;
  const sourceId = String(result.sourceId || "");
  const nextStatus = result.ok === true ? "verified" : "failed";
  const verifiedAt = result.at || new Date(now).toISOString();
  const sources = normalized.sources.map((source) => {
    if (sourceId && source.id !== sourceId) return source;
    if (!sourceId && source.role !== "primary") return source;
    return {
      ...source,
      status: nextStatus,
      effectiveStatus: nextStatus,
      verifiedAt,
      expiresAt: result.expiresAt || source.expiresAt,
      note: result.note || source.note,
    };
  });
  const playable = sources.some((source) => ["verified", "operator"].includes(source.status));
  return {
    ...normalized,
    sources,
    status: playable ? "verified" : "pending",
    verifiedAt: playable ? verifiedAt : normalized.verifiedAt,
  };
}

export function shouldHoldPlayer(plan) {
  if (!plan) return false;
  return plan.status === "waiting" || plan.status === "conflict";
}
