if (!window.__KZ_META_PIXEL_PAGEVIEW_SENT__) {
  window.__KZ_META_PIXEL_PAGEVIEW_SENT__ = true;
  // KoraZero Meta Pixel — PageView tracking for public pages.
  (function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    t = b.createElement(e);
    t.async = true;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
  
  fbq("init", "2344222863048329");
  fbq("track", "PageView");
  
}
