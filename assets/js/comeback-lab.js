/* KoraZero Comeback Lab — self-contained match scenario explorer. No live-feed calls. */
(function () {
  "use strict";

  function clamp(value, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.trunc(number))) : min;
  }

  function calculate(minute, ours, theirs) {
    const at = clamp(minute, 0, 90);
    const ourGoals = clamp(ours, 0, 15);
    const theirGoals = clamp(theirs, 0, 15);
    const remaining = 90 - at;
    const drawGoals = Math.max(0, theirGoals - ourGoals);
    const winGoals = Math.max(0, theirGoals - ourGoals + 1);
    return {
      minute: at,
      ours: ourGoals,
      theirs: theirGoals,
      remaining: remaining,
      drawGoals: drawGoals,
      winGoals: winGoals,
      minutesPerGoal: remaining > 0 && winGoals > 0 ? remaining / winGoals : null,
    };
  }

  // Exposed for deterministic unit tests and for future match-card integration.
  window.KZComebackLab = { calculate: calculate };

  const root = document.getElementById("comeback-lab");
  if (!root) return;

  const copy = {
    ar: {
      eyebrow: "KORAZERO / WHAT IF?",
      title: "هل يقدر يرجع في النتيجة؟",
      subtitle: "غيّر الدقيقة والنتيجة، وشوف كم هدف يحتاج فريقك — وتيرة الأهداف المطلوبة تتغير أمامك.",
      demo: "محاكاة افتراضية · ليست مباراة مباشرة",
      yours: "فريقك",
      rivals: "الخصم",
      minute: "الدقيقة",
      remaining: "المتبقي من الوقت الأصلي",
      change: "اصنع سيناريوك",
      currentMinute: "دقيقة المباراة",
      yourScore: "أهداف فريقك",
      theirScore: "أهداف الخصم",
      goalForUs: "⚽ هدف لفريقك",
      goalForThem: "⚽ هدف للخصم",
      draw: "للتعادل",
      win: "للفوز",
      rhythm: "معدل التسجيل المطلوب للفوز",
      zero: "لا حاجة",
      paceUnit: "دقيقة / هدف",
      goalUnit: "هدف",
      sample1: "ريمونتادا",
      sample2: "هدف قاتل",
      sample3: "تحدي صعب",
      share: "نسخ رابط السيناريو",
      copied: "✓ تم نسخ الرابط",
      shareFallback: "انسخ رابط السيناريو:",
      disclaimer: "حساب حسابي توضيحي، وليس توقعاً أو احتمال فوز. لا يشمل وقت بدل الضائع ولا أهداف الخصم المقبلة.",
      leading: "فريقك متقدم الآن. حافظ على التقدم حتى النهاية!",
      tied: "النتيجة متعادلة. هدف واحد يضع فريقك في المقدمة.",
      behind: "يحتاج فريقك إلى {draw} للتعادل، أو {win} للفوز، خلال {remaining} دقيقة من الوقت الأصلي.",
      atNinety: "وصلنا للدقيقة 90. الوقت الأصلي انتهى؛ قد يبقى وقت بدل الضائع، وهو غير محسوب هنا.",
      current: "الآن",
      goalMarker: "الهدف المطلوب رقم",
      na: "—",
    },
    en: {
      eyebrow: "KORAZERO / WHAT IF?",
      title: "Can they still come back?",
      subtitle: "Change the score and minute to reveal exactly how many goals your team needs — and how quickly.",
      demo: "Hypothetical scenario · not a live match",
      yours: "Your team",
      rivals: "Opposition",
      minute: "Minute",
      remaining: "Regulation time left",
      change: "Build your scenario",
      currentMinute: "Match minute",
      yourScore: "Your team's goals",
      theirScore: "Opposition goals",
      goalForUs: "⚽ Goal for your team",
      goalForThem: "⚽ Goal for opposition",
      draw: "To draw",
      win: "To win",
      rhythm: "Scoring pace needed to win",
      zero: "Not needed",
      paceUnit: "min / goal",
      goalUnit: "goals",
      sample1: "The comeback",
      sample2: "Last-minute winner",
      sample3: "Big challenge",
      share: "Copy scenario link",
      copied: "✓ Link copied",
      shareFallback: "Copy this scenario link:",
      disclaimer: "Illustrative arithmetic, not a prediction or win probability. Excludes stoppage time and any future opposition goals.",
      leading: "Your team is ahead. Hold onto the lead!",
      tied: "It's level. One more goal puts your team ahead.",
      behind: "Your team needs {draw} to draw, or {win} to win, with {remaining} minutes of regulation time left.",
      atNinety: "Minute 90: regulation time is over. Any stoppage time isn't included here.",
      current: "Now",
      goalMarker: "Required goal number",
      na: "—",
    },
  };

  const presets = [
    { minute: 80, ours: 0, theirs: 2 },
    { minute: 88, ours: 1, theirs: 1 },
    { minute: 65, ours: 1, theirs: 3 },
  ];

  function get(id) {
    return root.querySelector("#" + id);
  }

  const elements = {
    minute: get("cb-minute"),
    minuteReadout: get("cb-minute-readout"),
    ours: get("cb-ours"),
    theirs: get("cb-theirs"),
    remaining: get("cb-remaining"),
    draw: get("cb-draw"),
    win: get("cb-win"),
    rhythm: get("cb-rhythm"),
    story: get("cb-story"),
    indicator: get("cb-indicator"),
    goalMarkers: get("cb-goal-markers"),
    pitch: get("cb-pitch"),
    share: get("cb-share"),
  };

  const state = Object.assign({}, presets[0]);
  try {
    const raw = new URLSearchParams(window.location.search).get("comeback");
    const match = /^(\d{1,2})-(\d{1,2})-(\d{1,2})$/.exec(raw || "");
    if (match) {
      state.minute = clamp(match[1], 0, 90);
      state.ours = clamp(match[2], 0, 15);
      state.theirs = clamp(match[3], 0, 15);
    }
  } catch (_) {
    // A malformed share query never prevents the homepage from rendering.
  }

  function language() {
    return (document.documentElement.lang || "").toLowerCase().startsWith("en") ||
      (window.I18N && window.I18N.lang === "en") ? "en" : "ar";
  }

  function message(key) {
    return copy[language()][key];
  }

  function label(number) {
    return language() === "en" ? String(number) : String(number);
  }

  function refreshCopy() {
    root.querySelectorAll("[data-cb-i18n]").forEach(function (element) {
      const key = element.getAttribute("data-cb-i18n");
      if (message(key)) element.textContent = message(key);
    });
    root.setAttribute("dir", language() === "en" ? "ltr" : "rtl");
    render();
  }

  function addGoalMarkers(result) {
    elements.goalMarkers.replaceChildren();
    if (!result.remaining || !result.winGoals) return;
    for (let i = 1; i <= result.winGoals; i += 1) {
      const mark = document.createElement("span");
      mark.className = "cb-goal-mark";
      mark.style.left = ((result.minute + result.remaining * (i / (result.winGoals + 1))) / 90 * 100) + "%";
      mark.textContent = "⚽";
      mark.title = message("goalMarker") + " " + i;
      mark.setAttribute("aria-label", mark.title);
      elements.goalMarkers.appendChild(mark);
    }
  }

  function render() {
    const result = calculate(state.minute, state.ours, state.theirs);
    elements.minute.value = String(result.minute);
    elements.minuteReadout.textContent = label(result.minute) + "′";
    elements.ours.textContent = label(result.ours);
    elements.theirs.textContent = label(result.theirs);
    elements.remaining.textContent = label(result.remaining) + "′";
    elements.draw.textContent = label(result.drawGoals);
    elements.win.textContent = label(result.winGoals);
    elements.rhythm.textContent = result.winGoals === 0 ? message("zero") :
      result.minutesPerGoal === null ? message("na") :
      result.minutesPerGoal.toFixed(1) + " " + message("paceUnit");
    elements.indicator.style.left = (result.minute / 90 * 100) + "%";
    elements.minute.style.setProperty("--cb-progress", (result.minute / 90 * 100) + "%");

    if (result.minute === 90) {
      elements.story.textContent = message("atNinety");
    } else if (result.winGoals === 0) {
      elements.story.textContent = message("leading");
    } else if (result.drawGoals === 0) {
      elements.story.textContent = message("tied");
    } else {
      elements.story.textContent = message("behind")
        .replace("{draw}", result.drawGoals)
        .replace("{win}", result.winGoals)
        .replace("{remaining}", result.remaining);
    }
    addGoalMarkers(result);

    root.querySelectorAll("[data-cb-scenario]").forEach(function (button) {
      const preset = presets[Number(button.getAttribute("data-cb-scenario"))];
      const active = preset.minute === result.minute && preset.ours === result.ours && preset.theirs === result.theirs;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function updateScore(side, delta) {
    state[side] = clamp(state[side] + delta, 0, 15);
    render();
    if (delta > 0) {
      elements.pitch.classList.remove("cb-scored");
      // Reset just this decorative animation, without touching live match/player elements.
      void elements.pitch.offsetWidth;
      elements.pitch.classList.add("cb-scored");
    }
  }

  root.querySelectorAll("[data-cb-adjust]").forEach(function (button) {
    button.addEventListener("click", function () {
      const parts = button.getAttribute("data-cb-adjust").split(":");
      updateScore(parts[0], Number(parts[1]));
    });
  });

  root.querySelectorAll("[data-cb-scenario]").forEach(function (button) {
    button.addEventListener("click", function () {
      Object.assign(state, presets[Number(button.getAttribute("data-cb-scenario"))]);
      render();
    });
  });

  elements.minute.addEventListener("input", function () {
    state.minute = clamp(elements.minute.value, 0, 90);
    render();
  });

  elements.share.addEventListener("click", async function () {
    const url = new URL(window.location.href);
    url.searchParams.set("comeback", [state.minute, state.ours, state.theirs].join("-"));
    url.hash = "comeback-lab";
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url.toString());
        elements.share.textContent = message("copied");
        window.setTimeout(function () { elements.share.textContent = message("share"); }, 1800);
      } else if (navigator.share) {
        await navigator.share({ title: message("title"), url: url.toString() });
      } else {
        window.prompt(message("shareFallback"), url.toString());
      }
    } catch (_) {
      // Clipboard/share permissions are optional; manual copying remains possible.
      window.prompt(message("shareFallback"), url.toString());
    }
  });

  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(refreshCopy).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang", "dir"],
    });
  }
  refreshCopy();
})();