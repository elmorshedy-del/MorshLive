/* Inject the Khaleeji 27 poster as the first homepage hero slide. */
(function () {
  var track = document.querySelector(".home-showdown-track");
  if (!track) return;
  if (track.querySelector('img[src*="korazero-khaleeji27"]')) return;
  var img = document.createElement("img");
  img.src = "assets/img/korazero-khaleeji27.jpg?v=20260920hero";
  img.width = 1500;
  img.height = 844;
  img.alt = "كورة زيرو — خليجي 27 حصرياً، كأس الخليج العربي جدة السعودية 2026";
  img.decoding = "async";
  img.setAttribute("fetchpriority", "high");
  track.insertBefore(img, track.firstChild);
  var saudi = track.querySelector('img[src*="korazero-saudi"]');
  if (saudi) saudi.removeAttribute("fetchpriority");
})();
