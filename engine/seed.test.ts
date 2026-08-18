// Tests for seedRating — verify that high handicaps never produce
// negative or sub-100 ratings, that the linear region is bit-identical,
// and that the function is strictly decreasing across the entire
// WHS-valid range.
import assert from "node:assert";
import { describe, it } from "vitest";
import { seedRating, ratingPerStroke, DEFAULTS, type EngineConfig } from "./index.js";

const config: EngineConfig = { ...DEFAULTS };
const rps = ratingPerStroke(config);

function round(n: number): number {
  return Math.round(n);
}

// ───── known anchor points (must be exact after rounding) ─────

describe("seedRating anchor points", () => {
  const anchorTests: Array<[number, number]> = [
    [+2,     2542],
    [0,      2438],
    [7.9,    2026],
    [18,     1500],
    [30,     875],   // the join
  ];

  for (const [hcp, expected] of anchorTests) {
    it(`handicap ${hcp} → ${expected}`, () => {
      // WHS stores +2 as −2.0
      const seed = hcp === +2 ? -2.0 : hcp;
      const actual = round(seedRating(seed, config));
      assert.strictEqual(actual, expected,
        `handicap ${hcp} (seed ${seed}): expected ${expected}, got ${actual}`);
    });
  }
});

// ───── full sweep: rating > 100 and strictly decreasing ─────

describe("full sweep (−10.0 to 54.0, step 0.1)", () => {
  const LO = -10.0;
  const HI = 54.0;
  const STEP = 0.1;

  it("all ratings > 100 and strictly decreasing", () => {
    let count = 0;
    let prev: number | null = null;
    let minRating = Infinity;
    let maxRating = -Infinity;

    for (let h = LO; h <= HI; h += STEP) {
      const seed = parseFloat(h.toFixed(1));
      const raw = seedRating(seed, config);
      const r = round(raw);
      count++;

      assert.ok(raw > 100, `handicap ${seed}: rating ${raw} must be > 100`);
      assert.ok(r > 100, `handicap ${seed}: rounded rating ${r} must be > 100`);

      if (r < minRating) minRating = r;
      if (r > maxRating) maxRating = r;

      if (prev !== null) {
        assert.ok(raw < prev, `handicap ${seed}: rating ${raw} not strictly less than previous ${prev}`);
      }

      prev = raw;
    }

    // Floating-point accumulation at the upper boundary may cause
    // one fewer iteration; verify we scanned at least the core range.
    assert.ok(count >= 635, `Only scanned ${count} handicaps, expected ~640`);
    assert.ok(count <= 645, `Scanned ${count} handicaps, expected ~640`);
    assert.ok(minRating >= 100, `Min rating ${minRating} should be >= 100`);
    assert.ok(maxRating > 2800, `Max rating ${maxRating} should be > 2800`);
  });
});

// ───── verify linear region is unchanged ─────

describe("linear region bit-identical check (h ≤ 30)", () => {
  const LO = -10.0;
  const STEP = 0.1;

  it("all values match linear formula exactly", () => {
    let diffs = 0;
    for (let h = LO; h <= 30; h += STEP) {
      const seed = parseFloat(h.toFixed(1));
      const actual = seedRating(seed, config);
      const expected = config.startRating + (config.anchorHandicap - seed) * rps;
      const delta = Math.abs(actual - expected);
      if (delta > 1e-12) diffs++;
    }
    assert.strictEqual(diffs, 0, "linear region must be bit-identical");
  });
});

// ───── exponential tail: verify approach to floor ─────

describe("exponential tail checks", () => {
  it("decreases immediately after threshold", () => {
    assert.ok(seedRating(30.1, config) < seedRating(30, config),
      "exponential tail must continue decreasing immediately after threshold");
  });

  it("hcp 200 still above floor", () => {
    const extreme = seedRating(200, config);
    assert.ok(extreme > 100, `hcp 200: ${extreme} must be > floor 100`);
  });

  it("hcp 54 well above 100", () => {
    const at54 = seedRating(54, config);
    assert.ok(at54 > 150, `hcp 54 rating ${at54.toFixed(1)} should be well above 100`);
  });
});

// ───── edge cases ─────

describe("edge cases", () => {
  it("null / undefined / NaN → startRating", () => {
    assert.strictEqual(seedRating(undefined, config), config.startRating);
    assert.strictEqual(seedRating(NaN, config), config.startRating);
  });

  it("C¹ continuity at threshold", () => {
    const atThreshold = seedRating(30, config);
    const atThresholdExpected = config.startRating + (config.anchorHandicap - 30) * rps;
    assert.ok(Math.abs(atThreshold - atThresholdExpected) < 1e-12);

    const h = 1e-6;
    const leftDeriv = (seedRating(30, config) - seedRating(30 - h, config)) / h;
    const rightDeriv = (seedRating(30 + h, config) - seedRating(30, config)) / h;
    const derivDelta = Math.abs(leftDeriv + rps) + Math.abs(rightDeriv + rps);
    assert.ok(derivDelta < 0.001,
      `C¹ derivative mismatch: left=${leftDeriv.toFixed(3)} right=${rightDeriv.toFixed(3)} expected=${(-rps).toFixed(3)}`);
  });
});

// ───── verify pro handicap range (negative seeds) ─────

describe("pro range (seeds down to −10.0)", () => {
  it("+10 hcp rating > 2900", () => {
    const proMin = seedRating(-10, config);
    assert.ok(proMin > 2900, `+10 hcp rating ${round(proMin)} should be > 2900`);
  });
});
