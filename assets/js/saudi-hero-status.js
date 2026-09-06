/* Saudi hero availability copy.
 * Keeps the existing artwork/carousel intact while replacing the outdated
 * "coming soon" message with the current availability state.
 */
(function () {
  "use strict";

  function init() {
    const track = document.querySelector(".home-showdown-track");
    if (!track) return;

    const image = [...track.querySelectorAll("img")].find((img) =>
      String(img.getAttribute("src") || "").includes("korazero-saudi")
    );
    if (!image) return;

    image.alt = "كورة زيرو — متاح الآن، الدوري السعودي للمحترفين";
    if (image.closest(".kz-saudi-hero-slide")) return;

    const slide = document.createElement("div");
    slide.className = "kz-saudi-hero-slide";
    slide.style.cssText = [
      "position:relative",
      "display:block",
      "flex:0 0 50%",
      "width:50%",
      "overflow:hidden",
      "background:#05070c"
    ].join(";");

    image.parentNode.insertBefore(slide, image);
    slide.appendChild(image);
    image.style.setProperty("display", "block");
    image.style.setProperty("width", "100%");
    image.style.setProperty("height", "100%");
    image.style.setProperty("flex", "none");
    image.style.setProperty("object-fit", "cover");

    const copy = document.createElement("div");
    copy.className = "kz-saudi-hero-availability";
    copy.setAttribute("aria-hidden", "true");
    copy.style.cssText = [
      "position:absolute",
      "inset:42% 0 0",
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "justify-content:flex-end",
      "gap:clamp(5px,1vw,10px)",
      "padding:clamp(22px,4.6vw,54px) clamp(18px,4vw,48px)",
      "text-align:center",
      "direction:rtl",
      "pointer-events:none",
      "background:linear-gradient(180deg,rgba(5,7,12,0) 0%,rgba(5,7,12,.72) 46%,rgba(5,7,12,.94) 100%)",
      "color:#fff",
      "font-family:'IBM Plex Sans Arabic','Readex Pro',sans-serif",
      "text-shadow:0 2px 12px rgba(0,0,0,.6)"
    ].join(";");

    const status = document.createElement("div");
    status.textContent = "متاح الآن";
    status.style.cssText = [
      "font-size:clamp(.78rem,1.8vw,1.15rem)",
      "font-weight:700",
      "letter-spacing:.01em",
      "color:#8fffcf"
    ].join(";");

    const league = document.createElement("div");
    league.textContent = "الدوري السعودي للمحترفين";
    league.style.cssText = [
      "font-size:clamp(1.25rem,3.2vw,2.5rem)",
      "font-weight:700",
      "line-height:1.25"
    ].join(";");

    copy.append(status, league);
    slide.appendChild(copy);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
