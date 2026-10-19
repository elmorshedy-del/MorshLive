import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync("assets/js/comeback-lab.js", "utf8");
const homepage = readFileSync("index.html", "utf8");
const css = readFileSync("assets/css/comeback-lab.css", "utf8");

// A homepage without the widget is a valid context; startup should be inert.
const context = {
  window: {},
  document: {
    getElementById() {
      return null;
    },
  },
};
runInNewContext(source, context);
const calculate = context.window.KZComebackLab.calculate;

describe("KoraZero comeback lab", () => {
  it("calculates a two-goal comeback without invented win probabilities", () => {
    const result = calculate(80, 0, 2);
    expect(result.drawGoals).toBe(2);
    expect(result.winGoals).toBe(3);
    expect(result.remaining).toBe(10);
    expect(result.minutesPerGoal).toBeCloseTo(10 / 3);
  });

  it("handles a tied score and an existing lead", () => {
    const tied = calculate(88, 1, 1);
    expect(tied.drawGoals).toBe(0);
    expect(tied.winGoals).toBe(1);
    expect(tied.minutesPerGoal).toBe(2);

    const ahead = calculate(70, 3, 1);
    expect(ahead.drawGoals).toBe(0);
    expect(ahead.winGoals).toBe(0);
    expect(ahead.minutesPerGoal).toBeNull();
  });

  it("shows regulation expiry without dividing by zero", () => {
    const atNinety = calculate(90, 1, 3);
    expect(atNinety.remaining).toBe(0);
    expect(atNinety.winGoals).toBe(3);
    expect(atNinety.minutesPerGoal).toBeNull();
  });

  it("clamps invalid share and score inputs to valid boundaries", () => {
    const result = calculate(110, -3, 99);
    expect(result.minute).toBe(90);
    expect(result.ours).toBe(0);
    expect(result.theirs).toBe(15);
    expect(result.winGoals).toBe(16);
  });

  it("is an isolated homepage feature with versioned assets", () => {
    expect(homepage).toContain('id="comeback-lab"');
    expect(homepage).toContain("comeback-lab.css?v=20261019a");
    expect(homepage).toContain("comeback-lab.js?v=20261019a");
    expect(homepage).toContain('id="cb-minute"');
    expect(homepage).toContain('id="cb-story" aria-live="polite"');
    expect(homepage).toContain('id="cb-share"');
    expect(css).toContain("@media (max-width: 820px)");
    expect(source).not.toContain("fetch(");
  });
});
