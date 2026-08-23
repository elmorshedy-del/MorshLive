/* KoraZero content architecture — keeps current-season coverage, highlights,
 * World Cup archive, live viewing, and utilities as distinct destinations. */
(function (global) {
  "use strict";

  function isEnglish() {
    return (global.I18N && global.I18N.lang === "en") || document.documentElement.lang === "en";
  }

  const copy = {
    ar: {
      home: "الرئيسية",
      matches: "مباريات اليوم",
      highlights: "الملخصات",
      worldCup: "كأس العالم 2026",
      live: "البث المباشر",
      search: "بحث",
      allHighlights: "كل الملخصات ←",
      wcEyebrow: "أرشيف البطولة",
      wcTitle: "كأس العالم 2026 — 104 مباراة محفوظة",
      wcBody: "ارجع إلى نتائج البطولة وملخصاتها وأهدافها وأبرز لقطاتها من صفحة مستقلة لا تختلط بمباريات الموسم الحالي.",
      wcCta: "فتح أرشيف كأس العالم",
      wcStat1: "104 مباراة",
      wcStat2: "نتائج وأهداف",
      wcStat3: "ملخصات ولقطات",
    },
    en: {
      home: "Home",
      matches: "Today's matches",
      highlights: "Highlights",
      worldCup: "World Cup 2026",
      live: "Live",
      search: "Search",
      allHighlights: "All highlights →",
      wcEyebrow: "Tournament archive",
      wcTitle: "World Cup 2026 — all 104 matches",
      wcBody: "Revisit the tournament's results, goals, highlights and key moments in a permanent archive kept separate from the current season.",
      wcCta: "Open World Cup archive",
      wcStat1: "104 matches",
      wcStat2: "Results & goals",
      wcStat3: "Highlights & moments",
    },
  };

  function C() {
    return copy[isEnglish() ? "en" : "ar"];
  }

  function navLink(nav, role, href, label) {
    let link = nav.querySelector(`[data-kz-nav="${role}"]`);
    if (!link) {
      const selectors = {
        home: 'a[href="index.html"],a[href="/"]',
        matches: 'a[href="#matches"],a[href="index.html#matches"],a[href="/#matches"]',
        highlights: 'a[href="/highlights.html"],a[href="highlights.html"]',
        worldCup: 'a[href="/tournament"],a[href="tournament.html"]',
        live: 'a[href*="watch.html?ch=live"],a[href*="/watch?ch=live"]',
        search: 'a[href="search.html"],a[href="/search.html"]',
      };
      link = nav.querySelector(selectors[role] || "");
    }
    if (!link) {
      link = document.createElement("a");
      nav.appendChild(link);
    }
    link.dataset.kzNav = role;
    link.href = href;
    link.textContent = label;
    link.removeAttribute("data-i18n");
    return link;
  }

  function normalizeNav() {
    const c = C();
    document.querySelectorAll(".nav-links").forEach((nav) => {
      nav.querySelectorAll('a[href="#faq"],a[href="#saved"]').forEach((el) => el.remove());

      const home = navLink(nav, "home", "/", c.home);
      const matches = navLink(nav, "matches", "/#matches", c.matches);
      const highlights = navLink(nav, "highlights", "/highlights.html", c.highlights);
      const worldCup = navLink(nav, "worldCup", "/tournament", c.worldCup);
      const live = navLink(nav, "live", "/watch?ch=live", c.live);
      const search = navLink(nav, "search", "/search.html", c.search);
      const bookmark = nav.querySelector(".nav-bookmark");

      [home, matches, highlights, worldCup, live, search].forEach((link) => {
        if (bookmark) nav.insertBefore(link, bookmark);
        else nav.appendChild(link);
      });

      const path = location.pathname.replace(/\/$/, "") || "/";
      nav.querySelectorAll("a.active").forEach((a) => a.classList.remove("active"));
      let active = home;
      if (/highlights\.html$/.test(path)) active = highlights;
      else if (path === "/tournament" || /world-cup/.test(path)) active = worldCup;
      else if (/watch/.test(path)) active = live;
      else if (/search/.test(path)) active = search;
      else if (location.hash === "#matches") active = matches;
      active.classList.add("active");
    });
  }

  function worldCupPromo() {
    let section = document.getElementById("world-cup-archive-promo");
    if (!section) {
      section = document.createElement("section");
      section.id = "world-cup-archive-promo";
      section.className = "section home-world-cup-archive";
      section.innerHTML = `
        <div class="container">
          <div class="wc-archive-card">
            <div class="wc-archive-copy">
              <span class="wc-archive-eyebrow"></span>
              <h2 class="wc-archive-title"></h2>
              <p class="wc-archive-body"></p>
              <div class="wc-archive-stats">
                <span data-wc-stat="1"></span>
                <span data-wc-stat="2"></span>
                <span data-wc-stat="3"></span>
              </div>
              <a class="btn btn-primary wc-archive-cta" href="/tournament"></a>
            </div>
            <div class="wc-archive-mark" aria-hidden="true">
              <span class="wc-archive-year">2026</span>
              <span class="wc-archive-trophy">🏆</span>
            </div>
          </div>
        </div>`;
    }
    const c = C();
    section.querySelector(".wc-archive-eyebrow").textContent = c.wcEyebrow;
    section.querySelector(".wc-archive-title").textContent = c.wcTitle;
    section.querySelector(".wc-archive-body").textContent = c.wcBody;
    section.querySelector('[data-wc-stat="1"]').textContent = c.wcStat1;
    section.querySelector('[data-wc-stat="2"]').textContent = c.wcStat2;
    section.querySelector('[data-wc-stat="3"]').textContent = c.wcStat3;
    section.querySelector(".wc-archive-cta").textContent = c.wcCta;
    return section;
  }

  function organizeHome() {
    const matches = document.getElementById("matches");
    if (!matches) return;

    const currentHighlights = document.getElementById("highlight-banners");
    const tweets = document.getElementById("recent-tweets");
    const saved = document.getElementById("saved");
    const tv = document.getElementById("tv");
    const liveDetail = document.getElementById("live-detail")?.closest(".section");
    const faq = document.getElementById("faq");
    const promo = worldCupPromo();

    const allHighlights = document.querySelector(".home-hl-banners-all");
    if (allHighlights) {
      allHighlights.href = "/highlights.html";
      allHighlights.removeAttribute("data-i18n");
      allHighlights.textContent = C().allHighlights;
    }

    // There is no dedicated trends archive. A fake "view more" destination was
    // sending users into the World Cup archive, so remove the misleading CTA.
    document.querySelectorAll(".home-tweets-more").forEach((el) => el.remove());

    if (liveDetail) matches.parentNode.insertBefore(liveDetail, matches);

    let cursor = matches;
    const placeAfter = (node) => {
      if (!node || node === cursor) return;
      cursor.insertAdjacentElement("afterend", node);
      cursor = node;
    };

    placeAfter(saved);
    placeAfter(currentHighlights);
    placeAfter(promo);
    placeAfter(tweets);
    placeAfter(tv);

    if (faq && tv) tv.insertAdjacentElement("afterend", faq);
  }

  function apply() {
    normalizeNav();
    organizeHome();
  }

  function init() {
    apply();
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.type === "attributes" && m.attributeName === "lang")) apply();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
