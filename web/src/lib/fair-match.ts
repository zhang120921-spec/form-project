// Fair-Match Calculator — the inverse of the rating scale.
//
// A rating gap of ΔR corresponds to an expected margin of Δm strokes:
//   ΔR = (400 · α / ln 10) · Δm
//   Δm = ΔR / (400 · α / ln 10) = ΔR / ratingPerStroke(config)
//
// The divisor is derived from the LIVE alphaStroke at runtime, so
// changing α in the parameter lab keeps this consistent with the
// rest of the model.  Nine-hole rounds apply the same
// α_n = α₁₈ × √(18/n) scaling the engine already uses.

import {
  alphaForHoles,
  outcome,
  DEFAULTS,
  type EngineConfig,
} from "@engine/index.ts";
import { t } from "./i18n";

export type MatchFormat = "stroke" | "match" | "stableford";

/**
 * The divisor that converts a rating gap into strokes.
 *
 * For stroke / stableford: uses alphaStroke.
 * For match play:           uses alphaMatch.
 *
 * Both are scaled for hole count via α_n = α₁₈ × √(18/n).
 *
 * This is NEVER hardcoded — it is always derived from the live
 * config so that parameter-lab changes propagate automatically.
 */
export function fairMatchDivisor(
  format: MatchFormat,
  holes: number,
  config: EngineConfig = DEFAULTS
): number {
  const baseAlpha =
    format === "match" ? config.alphaMatch : config.alphaStroke;
  const alpha = alphaForHoles(baseAlpha, holes);
  return (400 * alpha) / Math.LN10;
}

/**
 * Exact (unrounded) strokes needed to make a match a coin flip.
 *
 * Positive = the higher-rated player should give strokes.
 * The value is a real number; callers round it for display.
 */
export function fairMatchStrokes(
  ratingA: number,
  ratingB: number,
  format: MatchFormat,
  holes: number,
  config: EngineConfig = DEFAULTS
): number {
  const gap = Math.abs(ratingA - ratingB);
  const divisor = fairMatchDivisor(format, holes, config);
  return gap / divisor;
}

export interface PlayerAllocation {
  playerId: string;
  name: string;
  rating: number;
  /** Whole strokes this player receives from the strongest player. */
  strokesReceived: number;
  /** Win probability after applying strokes, 0–1. */
  winProb: number;
  /** Raw (unrounded) strokes — for displaying the residual. */
  rawStrokes: number;
}

export interface FairMatchResult {
  /** Per-player allocations sorted strongest → weakest. */
  players: PlayerAllocation[];
  /** The raw strokes for the strongest-vs-weakest pairing. */
  recommendedStrokes: number;
  /** The rounded strokes actually allocated. */
  allocatedStrokes: number;
  /** Residual = raw − allocated. Non-zero means the match isn't perfectly even. */
  residual: number;
  /** The divisor used — derived from live alpha, never hardcoded. */
  divisor: number;
  format: MatchFormat;
  holes: number;
}

/**
 * Compute stroke allocations for 2–4 players relative to the
 * strongest.  Each weaker player receives strokes from the
 * strongest based on their pairwise rating gap.
 *
 * `override` lets the caller nudge the strongest-vs-weakest
 * allocation up or down; intermediate pairings scale proportionally.
 */
export function computeFairMatch(
  players: { id: string; name: string; rating: number }[],
  format: MatchFormat,
  holes: number,
  config: EngineConfig = DEFAULTS,
  override?: number
): FairMatchResult {
  if (players.length < 2 || players.length > 4) {
    throw new Error(t("Fair match requires 2–4 players"));
  }

  const sorted = [...players].sort((a, b) => b.rating - a.rating);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];

  const divisor = fairMatchDivisor(format, holes, config);
  const baseAlpha =
    format === "match" ? config.alphaMatch : config.alphaStroke;
  const alpha = alphaForHoles(baseAlpha, holes);

  // Raw strokes from strongest to weakest — this is the "recommended" amount.
  const recommendedStrokes =
    (strongest.rating - weakest.rating) / divisor;

  // If the user nudged the allocation, use that; otherwise round.
  const allocatedStrokes =
    override != null
      ? Math.max(0, Math.round(override))
      : Math.round(recommendedStrokes);

  const residual = recommendedStrokes - allocatedStrokes;

  const allocations: PlayerAllocation[] = sorted.map((p) => {
    // Pairwise gap from the strongest.
    const gap = strongest.rating - p.rating;
    const rawStrokes = gap / divisor;

    // Scale the allocated strokes proportionally to the raw ratio.
    const strokesReceived =
      recommendedStrokes > 0
        ? Math.round((rawStrokes / recommendedStrokes) * allocatedStrokes)
        : 0;

    return {
      playerId: p.id,
      name: p.name,
      rating: p.rating,
      strokesReceived: p.id === strongest.id ? 0 : strokesReceived,
      winProb: 0, // computed below
      rawStrokes,
    };
  });

  // Compute win probabilities for each player vs the strongest.
  // After giving `strokes` to a weaker player, the adjusted margin is
  //   adjusted = rawStrokes − strokesReceived
  // The strongest's prob of winning = outcome(adjusted, alpha).
  // The weaker player's prob = 1 − outcome(adjusted, alpha).
  for (let i = 0; i < allocations.length; i++) {
    const p = allocations[i];
    if (i === 0) {
      // Strongest player vs weakest: their effective margin shrinks by
      // the strokes they gave.
      p.winProb = outcome(recommendedStrokes - allocatedStrokes, alpha);
    } else {
      const effMargin = p.rawStrokes - p.strokesReceived;
      p.winProb = 1 - outcome(effMargin, alpha);
    }
  }

  return {
    players: allocations,
    recommendedStrokes,
    allocatedStrokes,
    residual,
    divisor,
    format,
    holes,
  };
}

/**
 * Build a conversational sentence describing the match.
 *
 * "Off the blues, gross stableford over nine holes, give Darren two shots."
 *
 * When AI is disabled, this deterministic template serves as the
 * fallback — the spec requires the product to work fully with AI off.
 */
export function phraseMatch(
  result: FairMatchResult,
  teeName: string,
  courseName: string
): string {
  const fmtLabel =
    result.format === "stableford"
      ? t("Stableford")
      : result.format === "match"
        ? t("match play")
        : t("stroke");

  const holesLabel = result.holes === 9 ? t("nine holes") : t("18 holes");

  // Find the player receiving the most strokes.
  const receiver = result.players
    .slice()
    .sort((a, b) => b.strokesReceived - a.strokesReceived)[0];

  if (!receiver || receiver.strokesReceived === 0) {
    return t("Off the {tee}, {format} over {holes} at {course}. Even match — no strokes needed.", {
      tee: teeName.toLowerCase(),
      format: fmtLabel.toLowerCase(),
      holes: holesLabel,
      course: courseName,
    });
  }

  const shotWord = receiver.strokesReceived === 1 ? t("shot") : t("shots");
  return t("Off the {tee}, {format} over {holes} at {course}, give {name} {n} {shotWord}.", {
    tee: teeName.toLowerCase(),
    format: fmtLabel.toLowerCase(),
    holes: holesLabel,
    course: courseName,
    name: receiver.name,
    n: receiver.strokesReceived,
    shotWord,
  });
}
