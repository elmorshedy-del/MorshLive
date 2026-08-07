import { describe, expect, it } from "vitest";
import {
  applyFilgoalHighlights,
  classifyFilgoalTitle,
  filgoalTitleTeams,
  parseFilgoalListingIds,
  resolveFilgoalFixtureKey,
} from "../scripts/filgoal-highlights-lib.js";

describe("classifyFilgoalTitle", () => {
  it("labels ملخص recaps as full", () => {
    expect(classifyFilgoalTitle("ملخص فوز البرازيل على مصر 2-1 (ودي)")).toBe("full");
  });

  it("tolerates the ملخلص editorial typo", () => {
    expect(classifyFilgoalTitle("ملخلص فوز إنجلترا على الكونغو الديمقراطية 2-1 (كأس العالم)")).toBe("full");
  });

  it("labels plural أهداف reels as goals", () => {
    expect(classifyFilgoalTitle("أهداف فوز المصري على إنبي 0-3 (نهائي كأس عاصمة مصر)")).toBe("goals");
  });

  it("excludes single-goal هدف clips", () => {
    expect(classifyFilgoalTitle("هدف مصر الأول ضد نيوزيلندا - مصطفى زيكو (كأس العالم)")).toBeNull();
  });

  it("excludes unrelated editorial content", () => {
    expect(classifyFilgoalTitle("وصول محمد صلاح إلى تركيا للانضمام لـ طرابزون")).toBeNull();
  });
});

describe("filgoalTitleTeams", () => {
  it("parses فوز A على B", () => {
    expect(filgoalTitleTeams("ملخص فوز البرازيل على مصر 2-1 (ودي)")).toEqual({ a: "البرازيل", b: "مصر" });
  });

  it("parses فوز A مع B", () => {
    expect(filgoalTitleTeams("ملخص فوز سويسرا مع كندا 2-1 (كأس العالم)")).toEqual({ a: "سويسرا", b: "كندا" });
  });

  it("parses تعادل A مع B", () => {
    expect(filgoalTitleTeams("ملخص تعادل المغرب مع البرازيل 1-1 (كأس العالم)")).toEqual({
      a: "المغرب",
      b: "البرازيل",
    });
  });

  it("parses تعادل A ضد B with no parenthetical score", () => {
    expect(filgoalTitleTeams("ملخص تعادل إيران ضد نيوزيلندا - كأس العالم 2026")).toEqual({
      a: "إيران",
      b: "نيوزيلندا",
    });
  });

  it("parses a penalty-shootout win with no scoreline digits", () => {
    expect(filgoalTitleTeams("ملخص فوز المغرب على هولندا بركلات الترجيح (كأس العالم)")).toEqual({
      a: "المغرب",
      b: "هولندا",
    });
  });

  it("returns null for titles without team-pair grammar", () => {
    expect(filgoalTitleTeams("مصطفى شوبير يتألق ضد رأسية براندون ميتشيل")).toBeNull();
  });
});

describe("resolveFilgoalFixtureKey", () => {
  const matches = [
    { home: "Egypt", away: "Belgium" },
    { home: "Morocco", away: "Canada" },
  ];
  const pairKeyFn = (a, b) => [a, b].sort().join("~");
  const arabicTeam = (name) =>
    ({ Egypt: "مصر", Belgium: "بلجيكا", Morocco: "المغرب", Canada: "كندا" })[name] || name;

  it("resolves a فوز/تعادل title to the matching fixture key", () => {
    const key = resolveFilgoalFixtureKey(
      "ملخص تعادل مصر مع بلجيكا 1-1 (كأس العالم)",
      pairKeyFn,
      matches,
      arabicTeam,
    );
    expect(key).toBe(pairKeyFn("Egypt", "Belgium"));
  });

  it("resolves regardless of which side is named first in the title", () => {
    const key = resolveFilgoalFixtureKey(
      "ملخص فوز المغرب على كندا 3-0 (كأس العالم)",
      pairKeyFn,
      matches,
      arabicTeam,
    );
    expect(key).toBe(pairKeyFn("Morocco", "Canada"));
  });

  it("returns null when neither team is tracked", () => {
    const key = resolveFilgoalFixtureKey(
      "ملخص فوز فرنسا على العراق 3-0 (كأس العالم 2026)",
      pairKeyFn,
      matches,
      arabicTeam,
    );
    expect(key).toBeNull();
  });
});

describe("parseFilgoalListingIds", () => {
  it("extracts unique numeric ids in document order", () => {
    const html = `
      <a href="/videos/50625/ملخص-تعادل-مصر-مع-بلجيكا-1-1-كأس-العالم">a</a>
      <a href="/videos/50607/مراسم-تسليم-المصري-كأس-عاصمة-مصر-2026">b</a>
      <a href="/videos/50625/ملخص-تعادل-مصر-مع-بلجيكا-1-1-كأس-العالم">dup</a>
    `;
    expect(parseFilgoalListingIds(html)).toEqual(["50625", "50607"]);
  });
});

describe("applyFilgoalHighlights", () => {
  it("attaches goals and full without clobbering an existing highlight", () => {
    const match = { highlights: { full: { videoUrl: "https://existing/full", kind: "full" } } };
    const bucket = {
      goals: { videoUrl: "https://filgoal/goals", title: "أهداف ..." },
      full: { videoUrl: "https://filgoal/full", title: "ملخص ..." },
    };
    const changed = applyFilgoalHighlights(match, bucket, (b) => b);
    expect(changed).toBe(true);
    expect(match.highlights.full.videoUrl).toBe("https://existing/full");
    expect(match.highlights.goals.videoUrl).toBe("https://filgoal/goals");
  });

  it("returns false for an empty bucket", () => {
    const match = {};
    expect(applyFilgoalHighlights(match, {}, (b) => b)).toBe(false);
  });
});
