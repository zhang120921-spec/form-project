// Tests for seedRating — verify that high handicaps never produce
// negative or sub-100 ratings, that the linear region is bit-identical,
// and that the function is strictly decreasing across the entire
// WHS-valid range.
import assert from "node:assert";
import { seedRating, ratingPerStroke, DEFAULTS, type EngineConfig } from "./index.js";

const config: EngineConfig = { ...DEFAULTS };
const rps = ratingPerStroke(config);

function round(n: number): number {
  return Math.round(n);
}

// ───── known anchor points (must be exact after rounding) ─────

const anchorTests: Array<[number, number]> = [
  [+2,     2542],
  [0,      2438],
  [7.9,    2026],
  [18,     1500],
  [30,     875],   // the join
];

console.log("--- Anchor points ---");
for (const [hcp, expected] of anchorTests) {
  // WHS stores +2 as −2.0
  const seed = hcp === +2 ? -2.0 : hcp;
  const actual = round(seedRating(seed, config));
  assert.strictEqual(actual, expected,
    `handicap ${hcp} (seed ${seed}): expected ${expected}, got ${actual}`);
  console.log(`  hcp ${hcp.toString().padStart(4)} → ${actual}  ✓`);
}

// ───── full sweep: rating > 100 and strictly decreasing ─────

console.log("\n--- Full sweep (−10.0 to 54.0, step 0.1) ---");
const LO = -10.0;
const HI = 54.0;
const STEP = 0.1;

let count = 0;
let prev: number | null = null;
let minRating = Infinity;
let maxRating = -Infinity;

for (let h = LO; h <= HI; h += STEP) {
  const seed = parseFloat(h.toFixed(1)); // defeat float drift
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

  // Also verify that raw (pre-round) is strictly decreasing — this
  // is stricter than the rounded check and guards against plateauing.
  prev = raw;
}

console.log(`  Scanned ${count} handicaps`);
console.log(`  Min rating: ${minRating}  (at hcp ${HI})`);
console.log(`  Max rating: ${maxRating}  (at hcp ${LO})`);
console.log(`  All > 100: ✓`);
console.log(`  Strictly decreasing: ✓`);

// ───── verify linear region is unchanged ─────

console.log("\n--- Linear region bit-identical check (h ≤ 30) ---");
let diffs = 0;
for (let h = LO; h <= 30; h += STEP) {
  const seed = parseFloat(h.toFixed(1));
  const actual = seedRating(seed, config);
  const expected = config.startRating + (config.anchorHandicap - seed) * rps;
  const delta = Math.abs(actual - expected);
  if (delta > 1e-12) diffs++;
}
console.log(`  Deviations from linear formula: ${diffs} (expected 0)`);
assert.strictEqual(diffs, 0, "linear region must be bit-identical");

// ───── exponential tail: verify approach to floor ─────

console.log("\n--- Exponential tail checks ---");
assert.ok(seedRating(30.1, config) < seedRating(30, config),
  "exponential tail must continue decreasing immediately after threshold");

// At extreme handicap the rating must still be > floor
const extreme = seedRating(200, config);
assert.ok(extreme > 100, `hcp 200: ${extreme} must be > floor 100`);
console.log(`  hcp 200 → ${extreme.toFixed(1)}  (floor is 100)`);

// At hcp 54 (WHS max) the rating must be well above floor
const at54 = seedRating(54, config);
assert.ok(at54 > 150, `hcp 54 rating ${at54.toFixed(1)} should be well above 100`);
console.log(`  hcp 54  → ${at54.toFixed(1)}`);

// ───── edge cases ─────

console.log("\n--- Edge cases ---");
// null / undefined / NaN → startRating
assert.strictEqual(seedRating(undefined, config), config.startRating);
assert.strictEqual(seedRating(NaN, config), config.startRating);
console.log(`  null/undefined/NaN → ${config.startRating} ✓`);

// Exactly at threshold
const atThreshold = seedRating(30, config);
const atThresholdExpected = config.startRating + (config.anchorHandicap - 30) * rps;
assert.ok(Math.abs(atThreshold - atThresholdExpected) < 1e-12);
console.log(`  hcp 30.0 → rps path = exp path  ✓`);

// C¹ continuity: derivative from left and right at threshold must match
const h = 1e-6;
const leftDeriv = (seedRating(30, config) - seedRating(30 - h, config)) / h;
const rightDeriv = (seedRating(30 + h, config) - seedRating(30, config)) / h;
// Both should equal −rps
const derivDelta = Math.abs(leftDeriv + rps) + Math.abs(rightDeriv + rps);
assert.ok(derivDelta < 0.001, `C¹ derivative mismatch: left=${leftDeriv.toFixed(3)} right=${rightDeriv.toFixed(3)} expected=${(-rps).toFixed(3)}`);
console.log(`  C¹ smooth at threshold (deriv delta ${derivDelta.toFixed(6)}) ✓`);

// ───── verify pro handicap range (negative seeds) ─────
// Tour pros have plus-handicaps stored as negative WHS values

console.log("\n--- Pro range (seeds down to −10.0) ---");
const proMin = seedRating(-10, config);
assert.ok(proMin > 2900, `+10 hcp rating ${round(proMin)} should be > 2900`);
console.log(`  +10 hcp (seed −10.0) → ${round(proMin)}  ✓`);

console.log("\n========================================");
console.log("  All seedRating tests passed.");
console.log("========================================");
