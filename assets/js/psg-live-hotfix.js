/* PSG vs Aston Villa: one fixed clean same-origin player.
 * No source cycling, no fallback ladder, no channel switching.
 */
(function () {
  const FIXED_SRC = "/sir/ar1/";
  let applying = false;

  function isPsgVillaPage() {
    const text = `${document.title || ""} ${document.getElementById("ch-name")?.textContent || ""}`;
    return /aston villa/i.test(text) && /(paris saint-germain|paris saint germain|paris sg|\bpsg\b|\bparis\b)/i.test(text);
  }

  function pin() {
    if (applying || !isPsgVillaPage()) return;
    const shell = document.getElementById("player-shell");
    if (!shell) return;
    const current = shell.querySelector("iframe.psg-fixed-frame");
    if (current && current.getAttribute("src") === FIXED_SRC) return;

    applying = true;
    shell.innerHTML = "";
    const frame = document.createElement("iframe");
    frame.className = "embed-frame psg-fixed-frame";
    frame.src = FIXED_SRC;
    frame.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
    frame.allowFullscreen = true;
    frame.scrolling = "no";
    frame.loading = "eager";
    frame.referrerPolicy = "same-origin";
    shell.appendChild(frame);
    applying = false;
  }

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(pin, 400);
    setTimeout(pin, 1800);
    const shell = document.getElementById("player-shell");
    if (!shell) return;
    new MutationObserver(function () {
      if (!applying && isPsgVillaPage() && !shell.querySelector("iframe.psg-fixed-frame")) {
        setTimeout(pin, 0);
      }
    }).observe(shell, { childList: true });
  });
})();
