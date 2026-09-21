/* Inject the Khaleeji 27 poster as the first homepage hero slide. */
(function () {
  function ensureCss() {
    if (document.querySelector('link[href*="home-showdown.css"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "assets/css/home-showdown.css?v=20260920khaleeji";
    document.head.appendChild(link);
  }

  function insertSlide(src) {
    var track = document.querySelector(".home-showdown-track");
    if (!track) return;
    if (track.querySelector("[data-kz-khaleeji27]")) return;
    var img = document.createElement("img");
    img.setAttribute("data-kz-khaleeji27", "1");
    img.src = src;
    img.width = 1500;
    img.height = 844;
    img.alt = "كورة زيرو — خليجي 27 حصرياً، كأس الخليج العربي جدة السعودية 2026";
    img.decoding = "async";
    img.setAttribute("fetchpriority", "high");
    track.insertBefore(img, track.firstChild);
    var saudi = track.querySelector('img[src*="korazero-saudi"]');
    if (saudi) saudi.removeAttribute("fetchpriority");
  }

  function loadFromParts() {
    var bases = [
      "assets/img/khaleeji27-part0.b64",
      "assets/img/khaleeji27-part1.b64",
      "assets/img/khaleeji27-part2.b64",
      "assets/img/khaleeji27-part3.b64"
    ];
    return Promise.all(bases.map(function (url) {
      return fetch(url, { cache: "force-cache" }).then(function (res) {
        if (!res.ok) throw new Error(url);
        return res.text();
      });
    })).then(function (parts) {
      insertSlide("data:image/jpeg;base64," + parts.join("").replace(/\s+/g, ""));
    });
  }

  function init() {
    ensureCss();
    insertSlide("assets/img/korazero-khaleeji27.jpg?v=20260920hero");
    loadFromParts().catch(function () {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
