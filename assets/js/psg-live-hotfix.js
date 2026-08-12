/* PSG vs Aston Villa: hard lock to the confirmed live Fabor embed.
 * This file intentionally runs after watch.js and prevents the generic stream
 * healer from taking this one match back to Sir/Koora/other sources.
 */
(function () {
  const FIXED_SRC = "https://912acsss8af382.fabortvcdn.com/playerv5.php?match=4728413&key=9f39972b67d6ce22189507d008acwc26";
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
      document.documentElement.dataset.psgVillaFaborLock = "1";
      return true;
    }
    const existing = document.querySelector(`iframe[src^="${FIXED_SRC}"]`);
    if (existing) {
      locked = true;
      document.documentElement.dataset.psgVillaFaborLock = "1";
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
    frame.width = "640";
    frame.height = "360";
    frame.setAttribute("frameborder", "0");
    frame.setAttribute("allowfullscreen", "");
    frame.scrolling = "no";
    frame.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
    // Match the supplied working embed: no sandbox and no referrer suppression.
    shell.appendChild(frame);
    applying = false;
    suppressOtherSources();
  }

  // watch.js listens for this message to heal/swap streams. For this confirmed
  // pinned match, stop that generic handler before it can replace Fabor.
  window.addEventListener("message", function (ev) {
    if (!detectTarget()) return;
    if (ev.data && ev.data.type === "kz-alt-reload") {
      ev.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener("DOMContentLoaded", function () {
    // Match data arrives asynchronously, so keep probing until the target is
    // recognised. Once recognised, `locked` never becomes false on this page.
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
      }).observe(shell, { childList: true, subtree: false, attributes: true, attributeFilter: ["src"] });
    }

    // Last-resort guard against periodic match refreshes/recovery events in the
    // legacy watch code. It does nothing while the exact frame is intact.
    setInterval(function () {
      if (locked) pin();
    }, 750);
  });
})();
