/* PSG vs Aston Villa: exact upstream embed supplied for this live game.
 * No source cycling, no fallback ladder, no channel switching.
 * Keep the iframe deliberately unsandboxed and do not suppress Referer: the
 * upstream player uses its normal embed request context to initialise media.
 */
(function () {
  const FIXED_SRC = "https://912acsss8af382.fabortvcdn.com/playerv5.php?match=4728413&key=9f39972b67d6ce22189507d008acwc26";
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
    frame.width = "640";
    frame.height = "360";
    frame.setAttribute("frameborder", "0");
    frame.setAttribute("allowfullscreen", "");
    frame.scrolling = "no";
    frame.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
    // Intentionally no sandbox and no referrerPolicy: mirror the supplied
    // working embed instead of stripping the parent Referer.
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
