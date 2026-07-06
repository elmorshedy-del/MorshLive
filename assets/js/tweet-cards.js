/* tweet-cards.js — shared native X/Twitter media cards (inline playback) */
(function () {
  "use strict";

  const t = (k, vars) => (window.I18N && window.I18N.t(k, vars)) || k;
  const teamLabel = (n) => (window.TeamNames && window.TeamNames.localize(n)) || n;

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function assetUrl(url) {
    return escapeHtml(String(url || "").replace(/&amp;/g, "&").trim());
  }

  function rawUrl(url) {
    return String(url || "").replace(/&amp;/g, "&").trim();
  }

  function formatCount(n) {
    const v = Number(n) || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return String(v);
  }

  function formatDate(kickoffUtc) {
    if (!kickoffUtc) return "";
    try {
      const d = new Date(kickoffUtc);
      const lang = document.documentElement.lang === "en" ? "en-GB" : "ar";
      return d.toLocaleDateString(lang, { day: "numeric", month: "short" });
    } catch { return ""; }
  }

  function tweetText(text) {
    return escapeHtml(String(text || "").replace(/https?:\/\/\S+/g, "").trim());
  }

  function authorInitial(author) {
    return escapeHtml(String(author || "X").charAt(0).toUpperCase());
  }

  function memeHasMedia(meme) {
    const item = (meme?.media || [])[0];
    return !!(item && (item.previewUrl || item.url));
  }

  function sortedMemes(memes) {
    return [...(memes || [])].sort((a, b) => (b.engagement || 0) - (a.engagement || 0));
  }

  function mediaMemes(memes) {
    return sortedMemes(memes).filter(memeHasMedia);
  }

  function matchLabel(meme) {
    if (!meme.home || !meme.away) return "";
    const score = meme.score ? ` ${meme.score}` : "";
    return `${teamLabel(meme.home)} vs ${teamLabel(meme.away)}${score}`;
  }

  function mediaHtml(item) {
    const isVideo = item.type === "video" || item.type === "animated_gif";
    const src = item.url || item.previewUrl;
    if (isVideo && item.url) {
      return `
        <div class="kz-tweet__media kz-tweet__media--video" data-video-url="${assetUrl(item.url)}">
          <img class="kz-tweet__poster" src="${assetUrl(item.previewUrl || item.url)}" alt="" loading="lazy" />
          <button type="button" class="kz-tweet__play" aria-label="${escapeHtml(t("tournament.playVideo"))}">▶</button>
        </div>`;
    }
    return `
      <div class="kz-tweet__media">
        <img src="${assetUrl(src)}" alt="" loading="lazy" />
      </div>`;
  }

  function memeHtml(meme, opts) {
    if (!meme || meme.type !== "tweet" || !meme.url || !memeHasMedia(meme)) return "";
    const showMatch = opts && opts.showMatch;
    const likes = meme.likes != null ? meme.likes : 0;
    const rts = meme.retweets != null ? meme.retweets : 0;
    const item = meme.media[0];
    const avatar = meme.avatarUrl
      ? `<img class="kz-tweet__avatar kz-tweet__avatar--img" src="${assetUrl(meme.avatarUrl)}" alt="" loading="lazy" />`
      : `<span class="kz-tweet__avatar" aria-hidden="true">${authorInitial(meme.author)}</span>`;
    return `
      <article class="kz-tweet">
        ${showMatch && matchLabel(meme) ? `<span class="kz-tweet__match">${escapeHtml(matchLabel(meme))}</span>` : ""}
        <div class="kz-tweet__head">
          ${avatar}
          <div class="kz-tweet__who">
            <b>@${escapeHtml(meme.author || "X")}</b>
            ${meme.postedAt ? `<time datetime="${escapeHtml(meme.postedAt)}">${formatDate(meme.postedAt)}</time>` : ""}
          </div>
          <a class="kz-tweet__x" href="${escapeHtml(meme.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(t("tournament.viewOnX"))}">𝕏</a>
        </div>
        <p class="kz-tweet__text" dir="auto">${tweetText(meme.text)}</p>
        ${mediaHtml(item)}
        <footer class="kz-tweet__foot">
          <span class="kz-tweet__stat" title="${t("tournament.tweetLikes")}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            ${formatCount(likes)}
          </span>
          <span class="kz-tweet__stat" title="${t("tournament.tweetRts")}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h11l-3-3 1.4-1.4L22 8l-6.6 5.4L14 12l3-3H7V7zm10 10H6l3 3-1.4 1.4L2 16l6.6-5.4L10 12l-3 3h10v2z"/></svg>
            ${formatCount(rts)}
          </span>
        </footer>
      </article>`;
  }

  function playVideoMedia(mediaEl) {
    if (!mediaEl || mediaEl.dataset.playing === "1") return;
    const url = rawUrl(mediaEl.dataset.videoUrl);
    if (!url) return;
    mediaEl.dataset.playing = "1";
    const poster = mediaEl.querySelector(".kz-tweet__poster");
    const btn = mediaEl.querySelector(".kz-tweet__play");
    if (poster) poster.remove();
    if (btn) btn.remove();
    const video = document.createElement("video");
    video.className = "kz-tweet__video";
    video.src = url;
    video.controls = true;
    video.playsInline = true;
    video.setAttribute("referrerpolicy", "no-referrer");
    video.setAttribute("preload", "metadata");
    mediaEl.appendChild(video);
    video.play().catch(() => { /* tap play in controls */ });
  }

  function bindVideoPlayers(root) {
    const scope = root || document;
    scope.querySelectorAll(".kz-tweet__media--video").forEach((el) => {
      if (el.dataset.bound === "1") return;
      el.dataset.bound = "1";
      const btn = el.querySelector(".kz-tweet__play");
      if (!btn) return;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        playVideoMedia(el);
      });
      el.addEventListener("click", (e) => {
        if (e.target.closest(".kz-tweet__play")) return;
        if (el.dataset.playing === "1") return;
        playVideoMedia(el);
      });
    });
  }

  function railHtml(memes, opts) {
    const list = mediaMemes(memes);
    if (!list.length) return "";
    const cls = (opts && opts.railClass) || "kz-tweet-rail";
    return `<div class="${cls}">${list.map((m) => memeHtml(m, opts)).join("")}</div>`;
  }

  window.KZTweets = {
    memeHasMedia,
    mediaMemes,
    sortedMemes,
    memeHtml,
    railHtml,
    bindVideoPlayers,
    playVideoMedia,
  };
})();
