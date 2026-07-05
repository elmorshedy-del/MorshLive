/* Match-scoped apology / ops notice — enable per incident in match-notice.json.
 * Dismiss persists in localStorage until config id changes or enabled is set false. */
(function (global) {
  "use strict";

  const STORAGE_PREFIX = "kz_match_notice_dismiss_";
  let _config = null;
  let _configAt = 0;

  function t(key, fallback) {
    return global.I18N ? global.I18N.t(key) : fallback;
  }

  function lang() {
    return (global.I18N && global.I18N.lang) || document.documentElement.lang || "ar";
  }

  function dismissKey(id) {
    return STORAGE_PREFIX + id;
  }

  function isDismissed(id) {
    try {
      return localStorage.getItem(dismissKey(id)) === "1";
    } catch {
      return false;
    }
  }

  function markDismissed(id) {
    try {
      localStorage.setItem(dismissKey(id), "1");
    } catch {
      /* noop */
    }
  }

  async function loadConfig() {
    if (_config && Date.now() - _configAt < 60 * 1000) return _config;
    try {
      const res = await fetch("assets/data/match-notice.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      _config = await res.json();
      _configAt = Date.now();
    } catch {
      _config = _config || null;
    }
    return _config;
  }

  function noticeText(cfg) {
    return lang() === "en" ? (cfg.textEn || cfg.textAr) : (cfg.textAr || cfg.textEn);
  }

  function matchApplies(cfg, match) {
    if (!cfg || !cfg.enabled || !match || !match.id) return false;
    const ids = cfg.matchIds || [];
    return ids.includes(match.id);
  }

  function buildNotice(cfg) {
    const el = document.createElement("aside");
    el.className = "kz-match-notice";
    el.setAttribute("dir", "rtl");
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.dataset.noticeId = cfg.id;

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "kz-match-notice__dismiss";
    dismiss.setAttribute("aria-label", t("notice.dismiss", "إغلاق"));
    dismiss.innerHTML = "✕";

    const body = document.createElement("div");
    body.className = "kz-match-notice__body";

    const icon = document.createElement("span");
    icon.className = "kz-match-notice__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "⚠️";

    const text = document.createElement("p");
    text.className = "kz-match-notice__text";
    text.textContent = noticeText(cfg);

    body.appendChild(icon);
    body.appendChild(text);
    el.appendChild(dismiss);
    el.appendChild(body);

    dismiss.addEventListener("click", () => {
      markDismissed(cfg.id);
      el.classList.add("kz-match-notice--hide");
      setTimeout(() => el.remove(), 280);
    });

    return el;
  }

  function renderInto(slot, cfg) {
    if (!slot || !cfg || !cfg.enabled || isDismissed(cfg.id)) {
      if (slot) slot.innerHTML = "";
      return false;
    }
    slot.innerHTML = "";
    slot.appendChild(buildNotice(cfg));
    return true;
  }

  async function showForMatch(slot, match) {
    const cfg = await loadConfig();
    if (!matchApplies(cfg, match)) {
      if (slot) slot.innerHTML = "";
      return false;
    }
    return renderInto(slot, cfg);
  }

  async function showForHome(slot, matches) {
    const cfg = await loadConfig();
    if (!cfg || !cfg.enabled || isDismissed(cfg.id)) {
      if (slot) slot.innerHTML = "";
      return false;
    }
    const ids = cfg.matchIds || [];
    const hit = (matches || []).find((m) => ids.includes(m.id));
    if (!hit) {
      if (slot) slot.innerHTML = "";
      return false;
    }
    return renderInto(slot, cfg);
  }

  global.MatchNotice = { showForMatch, showForHome, loadConfig };
})(window);
