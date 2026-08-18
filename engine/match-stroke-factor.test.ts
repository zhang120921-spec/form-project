// matchStrokeFactor was previously a config field nothing read — alphaMatch
// was a separately hardcoded constant that happened to equal
// alphaStroke * 1.45 by coincidence. These tests lock in that it's now a
// real, derived relationship (Lu's essay: alpha_match = c * alpha_stroke).
import assert from "node:assert";
import { describe, it } from "vitest";
import { alphaMatchFromFactor, DEFAULTS } from "./index.js";

describe("alphaMatchFromFactor", () => {
  it("multiplies stroke alpha by the match-stroke factor", () => {
    assert.strictEqual(alphaMatchFromFactor(0.3, 1.45), 0.435);
  });

  it("DEFAULTS.alphaMatch is actually derived from DEFAULTS.alphaStroke and DEFAULTS.matchStrokeFactor", () => {
    const expected = alphaMatchFromFactor(DEFAULTS.alphaStroke, DEFAULTS.matchStrokeFactor);
    assert.strictEqual(DEFAULTS.alphaMatch, expected);
  });

  it("changing the factor changes the derived alpha proportionally", () => {
    const base = alphaMatchFromFactor(0.3, 1.45);
    const doubled = alphaMatchFromFactor(0.3, 2.9);
    assert.strictEqual(doubled, base * 2);
  });
});
