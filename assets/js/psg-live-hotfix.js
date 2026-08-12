/* PSG vs Aston Villa: hard lock to the existing match-specific clean resolver.
 * The Worker already knows how to decode the Fabor/SIR playerv5 config, sign the
 * underlying HLS, proxy it through KoraZero, and render a clean same-origin player.
 */
(function () {
  const FIXED_SRC = "/siir/m/4728413";
  let applying = false;
  let locked = false;

  function targetText() {
    return `${document.title || ""} ${document.getElementById("ch-name")?.textContent || ""}`;
  }

  function detectTarget() {
    if (locked) return true;
    const text = targetText();
    if (/aston villa/i.test(text) && /(paris saint-germain|paris saint germain|paris sg|\bpsg\b|\bparis\b)/i.test(text)) {
      locked = true;
      document.documentElement.dataset.psgVillaCleanLock = "1";
      return true;
    }
    return false;
  }

  function suppressOtherSources() {
    if (!locked) return;
    ["alt-streams", "manual-mirrors"].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) {
        el.hidden = true;
        el.style.display = "none";
      }
    });
  }

  function pin() {
    if (applying || !detectTarget()) return;
    const shell = document.getElementById("player-shell");
    if (!shell) return;

    const current = shell.querySelector("iframe.psg-fixed-frame");
    if (current && current.getAttribute("src") === FIXED_SRC && shell.children.length === 1) {
      suppressOtherSources();
      return;
    }

    applying = true;
    shell.innerHTML = "";
    const frame = document.createElement("iframe");
    frame.className = "embed-frame psg-fixed-frame";
    frame.src = FIXED_SRC;
    frame.setAttribute("frameborder", "0");
    frame.setAttribute("allowfullscreen", "");
    frame.scrolling = "no";
    frame.loading = "eager";
    frame.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
    shell.appendChild(frame);
    applying = false;
    suppressOtherSources();
  }

  // Do not let the generic watch-page healer replace this match-specific route.
  window.addEventListener("message", function (ev) {
    if (!detectTarget()) return;
    if (ev.data && ev.data.type === "kz-alt-reload") ev.stopImmediatePropagation();
  }, true);

  document.addEventListener("DOMContentLoaded", function () {
    let probes = 0;
    const discover = setInterval(function () {
      probes += 1;
      if (detectTarget()) {
        pin();
        clearInterval(discover);
      } else if (probes > 80) {
        clearInterval(discover);
      }
    }, 250);

    const shell = document.getElementById("player-shell");
    if (shell) {
      new MutationObserver(function () {
        if (!applying && detectTarget()) setTimeout(pin, 0);
      }).observe(shell, { childList: true, subtree: false });
    }

    setInterval(function () {
      if (locked) pin();
    }, 1000);
  });
})();
