/* Shared match-stat editorial structure.
 * Fouls, offsides and cards are distinct concepts and should not be grouped
 * under a generic Discipline heading. Runs for both Arabic and English and
 * also handles dynamically refreshed match stats.
 */
(function () {
  "use strict";

  function norm(text) {
    return String(text || "").trim().toLowerCase();
  }

  function rowKind(row) {
    const label = norm(row.querySelector(".stat-label")?.textContent);
    if (/الأخطاء|fouls?/.test(label)) return "fouls";
    if (/التسلل|تسللات|offsides?/.test(label)) return "offsides";
    if (/البطاقات الصفراء|البطاقات الحمراء|yellow cards?|red cards?/.test(label)) return "cards";
    return "";
  }

  function groupLabel(kind) {
    const ar = document.documentElement.lang === "ar";
    if (kind === "fouls") return ar ? "الأخطاء" : "Fouls";
    if (kind === "offsides") return ar ? "التسلل" : "Offsides";
    return ar ? "البطاقات" : "Cards";
  }

  function splitGroup(group) {
    if (!group || group.dataset.kzSplitStats === "1") return;
    const rows = [...group.querySelectorAll(":scope > .stat-row")];
    const buckets = { fouls: [], offsides: [], cards: [] };
    rows.forEach((row) => {
      const kind = rowKind(row);
      if (kind) buckets[kind].push(row);
    });

    // Only rewrite the legacy mixed group when it actually contains the
    // different concepts together. Ordinary stat groups are left untouched.
    const present = Object.values(buckets).filter((list) => list.length).length;
    if (present < 2) return;

    const parent = group.parentNode;
    if (!parent) return;
    const icon = group.querySelector(".stat-group-head svg")?.outerHTML || "";

    ["fouls", "offsides", "cards"].forEach((kind) => {
      if (!buckets[kind].length) return;
      const next = document.createElement("div");
      next.className = "stat-group stat-group--" + kind;
      next.dataset.kzSplitStats = "1";
      next.innerHTML = `<div class="stat-group-head">${kind === "cards" ? icon : ""}<span>${groupLabel(kind)}</span></div>`;
      buckets[kind].forEach((row) => next.appendChild(row));
      parent.insertBefore(next, group);
    });
    group.remove();
  }

  function apply(root) {
    const scope = root?.querySelectorAll ? root : document;
    scope.querySelectorAll(".stat-group").forEach(splitGroup);
    if (scope.matches?.(".stat-group")) splitGroup(scope);
  }

  function start() {
    apply(document);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) apply(node);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
