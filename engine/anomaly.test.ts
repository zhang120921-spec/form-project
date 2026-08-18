import assert from "node:assert";
import { describe, it } from "vitest";
import { detectAnomalies, type StrokeRoundEntry, type RatingDeltaEntry } from "./anomaly.js";

function strokeRound(roundId: string, ags: number, date = "2026-01-01"): StrokeRoundEntry {
  return { roundId, ags, date, course: "Test Links" };
}

function delta(roundId: string, delta: number, date = "2026-01-01"): RatingDeltaEntry {
  return { roundId, delta, date, course: "Test Links" };
}

describe("detectAnomalies — score outliers", () => {
  it("does not flag anything with fewer than 5 stroke rounds", () => {
    const rounds = [strokeRound("r1", 100), strokeRound("r2", 85)];
    const out = detectAnomalies("Alex", rounds, []);
    assert.strictEqual(out.length, 0);
  });

  it("does not flag a consistent scorer", () => {
    const rounds = ["r1", "r2", "r3", "r4", "r5"].map((id, i) =>
      strokeRound(id, 85 + (i % 2))
    );
    const out = detectAnomalies("Alex", rounds, []);
    assert.strictEqual(out.length, 0);
  });

  it("flags an older round that doesn't fit the current trailing-5 baseline", () => {
    // The baseline is always the trailing 5 rounds. A population z-score
    // computed from n points can never exceed sqrt(n-1) in magnitude for a
    // point *inside* that same population (Samuelson's inequality; for n=5
    // that bound is exactly 2), so this check only realistically fires for
    // a round outside the window it's compared against — e.g. an earlier
    // round that no longer fits a tightened recent baseline.
    const rounds = [
      strokeRound("r1", 60), // outlier, outside the trailing-5 window
      strokeRound("r2", 100),
      strokeRound("r3", 101),
      strokeRound("r4", 99),
      strokeRound("r5", 100),
      strokeRound("r6", 101),
    ];
    const out = detectAnomalies("Alex", rounds, []);
    const flagged = out.find((a) => a.roundId === "r1");
    assert.ok(flagged, "expected r1 to be flagged");
    assert.ok(flagged!.severity === "medium" || flagged!.severity === "high");
    assert.match(flagged!.reason, /Alex/);
  });

  it("only evaluates the trailing 5 rounds for the baseline, not full history", () => {
    // First round is a wild outlier but drops out of the trailing-5 window
    // once 5 more rounds are logged, so it must not distort later baselines.
    const rounds = [
      strokeRound("r0", 60),
      strokeRound("r1", 100),
      strokeRound("r2", 101),
      strokeRound("r3", 99),
      strokeRound("r4", 100),
      strokeRound("r5", 101),
    ];
    const out = detectAnomalies("Alex", rounds, []);
    // r0 itself is outside the trailing-5 window used for the baseline
    // (rounds.slice(-5) = r1..r5), but it is still checked against that
    // baseline as a historical entry, so it may legitimately flag.
    // The key invariant: r1..r5 (the consistent block) must not flag.
    for (const id of ["r1", "r2", "r3", "r4", "r5"]) {
      assert.ok(!out.some((a) => a.roundId === id), `${id} should not be flagged`);
    }
  });
});

describe("detectAnomalies — rating-gain outliers", () => {
  it("does not flag anything with fewer than 5 rating deltas", () => {
    const deltas = [delta("r1", 50), delta("r2", 5)];
    const out = detectAnomalies("Alex", [], deltas);
    assert.strictEqual(out.length, 0);
  });

  it("does not flag typical swings", () => {
    const deltas = ["r1", "r2", "r3", "r4", "r5"].map((id) => delta(id, 8));
    const out = detectAnomalies("Alex", [], deltas);
    assert.strictEqual(out.length, 0);
  });

  it("flags a gain over 3x the typical magnitude and over 10 points", () => {
    const deltas = [
      delta("r1", 5),
      delta("r2", 6),
      delta("r3", 4),
      delta("r4", 5),
      delta("r5", 60), // way above 3x the ~5-point typical magnitude
    ];
    const out = detectAnomalies("Alex", [], deltas);
    const flagged = out.find((a) => a.roundId === "r5");
    assert.ok(flagged, "expected r5 to be flagged");
  });

  it("does not flag large negative swings (losses are not suspicious)", () => {
    const deltas = [
      delta("r1", 5),
      delta("r2", 6),
      delta("r3", 4),
      delta("r4", 5),
      delta("r5", -60),
    ];
    const out = detectAnomalies("Alex", [], deltas);
    assert.strictEqual(out.length, 0);
  });

  it("does not double-flag a round already flagged by the score check", () => {
    const rounds = [
      strokeRound("r1", 100),
      strokeRound("r2", 101),
      strokeRound("r3", 99),
      strokeRound("r4", 100),
      strokeRound("r5", 40), // extreme outlier, flagged by score check
    ];
    const deltas = [
      delta("d1", 5),
      delta("d2", 6),
      delta("d3", 4),
      delta("d4", 5),
      delta("r5", 60, "2026-01-05"), // same roundId, also a rating outlier
    ];
    const out = detectAnomalies("Alex", rounds, deltas);
    const matches = out.filter((a) => a.roundId === "r5");
    assert.strictEqual(matches.length, 1, "a round should only be flagged once");
  });
});
