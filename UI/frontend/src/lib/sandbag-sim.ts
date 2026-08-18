// Sandbag immunity simulator — fixed-seed dataset that runs the real engine.
// Both paths (sandbag + honest) use identical opponents; only "You"'s scores differ.
// This module is imported by both the explainer page and the test suite,
// guaranteeing they can never drift out of sync.

import { replay, DEFAULTS, type Player, type Round, type PlayerState, type EngineConfig } from "@engine/index.ts";

// ── Course parameters ──────────────────────────────────────
const CR = 72;
const SLOPE = 135;
const PAR = 72;
const PCC = 0;

// ── Opponents (identical in both paths) ────────────────────
// Seeded with handicaps so their starting ratings are calibrated:
//   seed=10 → ~1917,  seed=16 → ~1604,  seed=20 → ~1396
const OPPONENTS: Player[] = [
  { id: "opp-a", name: "Marcus", club: "SGC", seed: 10 },
  { id: "opp-b", name: "David",  club: "SGC", seed: 16 },
  { id: "opp-c", name: "Hugo",   club: "SGC", seed: 20 },
];

// "You" starts unseeded at 1500 — no prior handicap index,
// so the 10 rounds fully determine both rating and handicap.
const YOU: Player = { id: "you", name: "You", club: "—", seed: undefined };

// ── Opponent scores (same in every round, both paths) ─────
const OPP_SCORES: number[][] = [
  [82, 88, 92],
  [80, 87, 93],
  [84, 86, 91],
  [81, 89, 94],
  [83, 88, 90],
  [82, 87, 92],
  [80, 86, 91],
  [84, 89, 93],
  [81, 88, 90],
  [83, 87, 92],
];

// ── "You" honest path ─────────────────────────────────────
// Scores around 85 — roughly a 13-handicap round on this course.
const HONEST_SCORES = [85, 84, 86, 83, 85, 84, 86, 85, 84, 85];

// ── "You" sandbag path ────────────────────────────────────
// Scores around 100 — ~15 strokes worse than honest.
const SANDBAG_SCORES = [100, 102, 98, 101, 100, 99, 103, 100, 101, 99];

// ── Build rounds for a given "You" score set ──────────────
function buildRounds(youScores: number[]): Round[] {
  return youScores.map((yourAgs, i) => {
    const [oppA, oppB, oppC] = OPP_SCORES[i];
    return {
      id: `r${i + 1}`,
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      format: "stroke" as const,
      course: "Sentosa GC",
      par: PAR,
      holes: 18,
      participants: [
        { playerId: "you",  ags: yourAgs, cr: CR, slope: SLOPE, pcc: PCC },
        { playerId: "opp-a", ags: oppA,    cr: CR, slope: SLOPE, pcc: PCC },
        { playerId: "opp-b", ags: oppB,    cr: CR, slope: SLOPE, pcc: PCC },
        { playerId: "opp-c", ags: oppC,    cr: CR, slope: SLOPE, pcc: PCC },
      ],
    };
  });
}

export interface SimResult {
  sandbag: { rating: number; hcpIndex: number | null };
  honest: { rating: number; hcpIndex: number | null };
}

/**
 * Run both paths through the real `replay` function.
 * Deterministic — same input, same output, every time.
 */
export function runSandbagSim(config: EngineConfig = DEFAULTS): SimResult {
  const players = [YOU, ...OPPONENTS];

  const sandbagReplay = replay(players, buildRounds(SANDBAG_SCORES), config);
  const honestReplay = replay(players, buildRounds(HONEST_SCORES), config);

  const sandbagYou = sandbagReplay.players.find((p) => p.id === "you")!;
  const honestYou = honestReplay.players.find((p) => p.id === "you")!;

  return {
    sandbag: { rating: sandbagYou.rating, hcpIndex: sandbagYou.hcpIndex },
    honest: { rating: honestYou.rating, hcpIndex: honestYou.hcpIndex },
  };
}

// Export the raw data for the test that verifies no hardcoding.
export { YOU, OPPONENTS, OPP_SCORES, HONEST_SCORES, SANDBAG_SCORES, buildRounds, CR, SLOPE, PAR, PCC };
