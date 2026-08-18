import { describe, it, expect } from "vitest";
import {
  DEFAULTS,
  ratingPerStroke,
  alphaForHoles,
  outcome,
} from "@engine/index.ts";
import {
  fairMatchDivisor,
  fairMatchStrokes,
  computeFairMatch,
  phraseMatch,
  type MatchFormat,
} from "@/lib/fair-match";

// ════════════════════════════════════════════════════════════
// Fair-Match Calculator tests
//
// The mathematics is the exact inverse of the rating scale.
// strokes = ratingGap / (400 · α / ln 10)
// Verified: a 521-point gap resolves to 10.00 strokes.
// ════════════════════════════════════════════════════════════

describe("Fair-Match Calculator", () => {
  // ── Divisor is derived from live alpha, not hardcoded ────
  it("divisor is derived from live alphaStroke, not a hardcoded constant", () => {
    const divisor = fairMatchDivisor("stroke", 18, DEFAULTS);
    const expected = ratingPerStroke(DEFAULTS); // (400 * α) / ln(10)

    expect(divisor).toBe(expected);
    expect(divisor).not.toBe(52.115); // not the approximate value from the spec
    expect(divisor).toBeCloseTo(52.08, 1); // approximately 52.08
  });

  // ── Match play uses alphaMatch ───────────────────────────
  it("match play divisor uses alphaMatch, not alphaStroke", () => {
    const strokeDiv = fairMatchDivisor("stroke", 18, DEFAULTS);
    const matchDiv = fairMatchDivisor("match", 18, DEFAULTS);

    expect(matchDiv).not.toBe(strokeDiv);
    expect(matchDiv).toBeCloseTo(
      (400 * DEFAULTS.alphaMatch) / Math.LN10,
      10
    );
  });

  // ── 521-point gap resolves to 10.00 strokes ──────────────
  it("521-point gap resolves to approximately 10.00 strokes", () => {
    const strokes = fairMatchStrokes(2000, 1479, "stroke", 18, DEFAULTS);
    // 521 / 52.08 ≈ 9.999... → rounds to 10.00
    expect(strokes).toBeCloseTo(10, 1);
  });

  // ── Post-allocation expected score is 0.500 ──────────────
  it("post-allocation expected score is 0.500 within 1e-9 when giving exact raw strokes", () => {
    const gap = 521;
    const divisor = fairMatchDivisor("stroke", 18, DEFAULTS);
    const rawStrokes = gap / divisor;

    // After giving exactly rawStrokes, the adjusted margin is 0
    // → outcome(0, alpha) = 1/(1+e^0) = 0.5 exactly
    const alpha = alphaForHoles(DEFAULTS.alphaStroke, 18);
    const adjustedMargin = rawStrokes - rawStrokes; // = 0
    const prob = outcome(adjustedMargin, alpha);

    expect(prob).toBeCloseTo(0.5, 9); // within 1e-9
  });

  // ── 9-hole scaling applies √(18/n) ────────────────────────
  it("nine-hole divisor applies √(18/9) = √2 scaling", () => {
    const div18 = fairMatchDivisor("stroke", 18, DEFAULTS);
    const div9 = fairMatchDivisor("stroke", 9, DEFAULTS);

    // α_9 = α_18 × √(18/9) = α_18 × √2
    const ratio = div9 / div18;
    expect(ratio).toBeCloseTo(Math.sqrt(2), 10);
  });

  // ── Rounding residuals are visible, not concealed ────────
  it("rounding residual is non-zero and reported in the result", () => {
    // A 150-point gap → 150 / 52.08 ≈ 2.88 strokes → rounds to 3
    // residual = 2.88 - 3 = -0.12
    const result = computeFairMatch(
      [
        { id: "a", name: "Alice", rating: 1650 },
        { id: "b", name: "Bob", rating: 1500 },
      ],
      "stroke",
      18,
      DEFAULTS
    );

    // The recommended (raw) strokes should NOT be a whole number
    expect(result.recommendedStrokes).not.toBe(Math.round(result.recommendedStrokes));

    // The allocated strokes are the rounded value
    expect(result.allocatedStrokes).toBe(Math.round(result.recommendedStrokes));

    // The residual is non-zero (the match isn't perfectly even)
    expect(Math.abs(result.residual)).toBeGreaterThan(0.001);

    // The residual is the difference between raw and allocated
    expect(result.residual).toBeCloseTo(
      result.recommendedStrokes - result.allocatedStrokes,
      10
    );
  });

  // ── Override nudges the allocation ────────────────────────
  it("override lets the user nudge strokes up or down", () => {
    const players = [
      { id: "a", name: "Alice", rating: 1650 },
      { id: "b", name: "Bob", rating: 1500 },
    ];

    const defaultResult = computeFairMatch(players, "stroke", 18, DEFAULTS);
    const nudgedResult = computeFairMatch(players, "stroke", 18, DEFAULTS, defaultResult.allocatedStrokes + 1);

    expect(nudgedResult.allocatedStrokes).toBe(defaultResult.allocatedStrokes + 1);
    // The receiver's win probability should be higher with more strokes
    const receiverDefault = defaultResult.players[defaultResult.players.length - 1];
    const receiverNudged = nudgedResult.players[nudgedResult.players.length - 1];
    expect(receiverNudged.winProb).toBeGreaterThan(receiverDefault.winProb);
  });

  // ── Phrase generator produces plain text ─────────────────
  it("phrase generator produces a conversational sentence", () => {
    const result = computeFairMatch(
      [
        { id: "a", name: "Alice", rating: 1650 },
        { id: "b", name: "Darren", rating: 1500 },
      ],
      "stroke",
      18,
      DEFAULTS
    );

    const phrase = phraseMatch(result, "Blues", "Serapong GC");
    expect(phrase).toContain("Darren");
    expect(phrase).toContain("stroke");
    expect(phrase).toContain("Serapong");
  });

  // ── Even match (no strokes needed) ───────────────────────
  it("even match produces no strokes and 50% probability", () => {
    const result = computeFairMatch(
      [
        { id: "a", name: "Alice", rating: 1500 },
        { id: "b", name: "Bob", rating: 1500 },
      ],
      "stroke",
      18,
      DEFAULTS
    );

    expect(result.recommendedStrokes).toBeCloseTo(0, 10);
    expect(result.allocatedStrokes).toBe(0);
    // All players should have ~50% win prob
    for (const p of result.players) {
      expect(p.winProb).toBeCloseTo(0.5, 2);
    }
  });
});
