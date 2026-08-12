/* PSG vs Aston Villa: pin the main player to one match-specific route.
 *
 * The frame is marked data-kz-pinned so watch.js's generic healer skips it.
 * Without that mark the two scripts fight over #player-shell: the healer
 * appends `_heal=<ts>` to the src, this file sees a src that no longer equals
 * FIXED_SRC, rebuilds the iframe from scratch, and the fresh frame never
 * reaches `load` — so the healer fires again. The frame renders correctly and
 * never plays, once per second, forever.
 */
(function () {
  const FIXED_SRC = "/siir/m/4728413";
  let locked = false;
  let observer = null;

  // Compare resolved URLs: assigning frame.src absolutises it, so a raw
  // attribute comparison against a relative FIXED_SRC can never match again.
  function sameSrc(a, b) {
    try {
      return new URL(a, location.href).href === new URL(b, location.href).href;
    } catch {
      return a === b;
    }
  }

  function targetText() {
    return `${document.title || ""} ${document.getElementById("ch-name")?.textContent || ""}`;
  }

  function detectTarget() {
    if (locked) return true;
    const text = targetText();
    // Both sides must match. A bare /paris/ alternative would also pin every
    // other Paris fixture to this match's route.
    if (/aston villa/i.test(text) && /(paris saint-germain|paris saint germain|paris sg|\bpsg\b)/i.test(text)) {
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
    if (!detectTarget()) return;
    const shell = document.getElementById("player-shell");
    if (!shell) return;

    const current = shell.querySelector("iframe.psg-fixed-frame");
    if (current && sameSrc(current.src, FIXED_SRC) && shell.children.length === 1) {
      suppressOtherSources();
      return;
    }

    // Detach while mutating. MutationObserver callbacks are delivered as
    // microtasks after this function returns, so a plain `applying` flag is
    // already back to false by the time the callback runs and cannot guard it.
    if (observer) observer.disconnect();

    shell.innerHTML = "";
    const frame = document.createElement("iframe");
    frame.className = "embed-frame psg-fixed-frame";
    frame.dataset.kzPinned = "1";
    frame.src = FIXED_SRC;
    frame.setAttribute("frameborder", "0");
    frame.setAttribute("allowfullscreen", "");
    frame.scrolling = "no";
    frame.loading = "eager";
    frame.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
    shell.appendChild(frame);

    if (observer) observer.observe(shell, { childList: true, subtree: false });
    suppressOtherSources();
  }

  document.addEventListener("DOMContentLoaded", function () {
    // Match data arrives asynchronously, so keep probing until the target is
    // recognised (bounded — this is discovery, not enforcement).
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
      observer = new MutationObserver(function () {
        if (detectTarget()) pin();
      });
      observer.observe(shell, { childList: true, subtree: false });
    }
  });
})();
