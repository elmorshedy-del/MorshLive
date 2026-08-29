/* Final Arabic editorial pass for user-facing copy.
 * Keep SEO phrases natural and avoid presenting time zones as a product feature.
 */
(function () {
  "use strict";

  if (document.documentElement.lang !== "ar") return;

  const replacements = new Map([
    ["أدناه", "هنا"],
    ["ادناه", "هنا"],
    ["بتوقيت الرياض وET", "المواعيد حسب توقيتك المحلي"],
  ]);

  function cleanText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      let value = node.nodeValue;
      for (const [from, to] of replacements) value = value.replaceAll(from, to);
      node.nodeValue = value;
    }
  }

  function setText(selector, text) {
    const el = document.querySelector(selector);
    if (el) el.textContent = text;
  }

  function setMeta(name, content) {
    const el = document.querySelector(`meta[name="${name}"]`);
    if (el) el.setAttribute("content", content);
  }

  function apply() {
    cleanText(document.body);

    setText(
      ".hero-lede",
      "شاهد مباريات اليوم مباشرة بجودة HD وبدون إعلانات أو نوافذ منبثقة. تابع أهم البطولات، واعرف موعد كل مباراة والقناة والمعلّق عند توفر البيانات. تظهر المواعيد تلقائياً حسب توقيت جهازك.",
    );

    const keywordTime = document.querySelector('[data-i18n="seo.kw6"]');
    if (keywordTime) keywordTime.textContent = "المواعيد حسب توقيتك المحلي";

    setMeta(
      "description",
      "شاهد مباريات اليوم مباشرة على كورة زيرو بجودة HD وبدون إعلانات أو نوافذ منبثقة، مع المواعيد والقنوات والمعلّقين عند توفر البيانات.",
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply, { once: true });
  } else {
    apply();
  }
})();
