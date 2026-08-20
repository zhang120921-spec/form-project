// AI Round Narrator — turns structured engine results into 2–3
// sentences of plain, warm English.
//
// CONSTRAINTS (from the spec):
//   1. AI never computes a rating.  Every number the LLM sees is
//      already computed by the engine and passed in verbatim.
//   2. Narration is generated ONCE at commit time, stored on the
//      round record, and never regenerated on view.
//   3. The product works fully with AI disabled.  When AI is off,
//      a deterministic template produces the narration — the same
//      inputs always produce the same text.
//   4. Tone: factual and encouraging without being congratulatory
//      about bad rounds.  A losing round is narrated honestly.
//
// The template generator is the primary path.  The AI generator
// is an optional enhancement that calls an LLM endpoint when
// available.

import type { ReplayedRound, PlayerState } from "@engine/index.ts";
import { DEFAULTS, type EngineConfig } from "@engine/index.ts";
import { t } from "./i18n";

export interface NarrationInput {
  /** The round to narrate, from the engine's replay output. */
  round: ReplayedRound;
  /** All players (to look up opponent names). */
  players: PlayerState[];
  /** The viewer's player ID. */
  viewerId: string;
  /** The viewer's recent form trajectory (deltas from last N rounds). */
  recentDeltas: number[];
  /** The K-factor in effect for this round. */
  k: number;
}

export interface NarrationResult {
  text: string;
  source: "template" | "ai";
  generatedAt: string;
}

/**
 * Deterministic template-based narration.
 *
 * This is the fallback when AI is disabled, and also the baseline
 * that the AI version enhances.  It produces 2–3 sentences of
 * plain English from the structured round data.
 *
 * Every number in the output comes from the engine — nothing is
 * computed or hallucinated here.
 */
export function generateTemplateNarration(input: NarrationInput): string {
  const { round, players, viewerId, recentDeltas, k } = input;

  const viewer = players.find((p) => p.id === viewerId);
  if (!viewer) return "";

  const snap = round.snapshot.find((s) => s.playerId === viewerId);
  if (!snap) return "";

  const delta = snap.delta;
  const deltaSign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const deltaAbs = Math.abs(delta).toFixed(1);

  // Find the biggest pairwise result for the viewer.
  const myPairs = round.pairs.filter(
    (p) => p.a === viewerId || p.b === viewerId
  );

  let biggestMargin = 0;
  let biggestOppName = "";
  let beatOpp = false;

  for (const pair of myPairs) {
    const isA = pair.a === viewerId;
    const margin = isA ? pair.margin : -pair.margin;
    const oppId = isA ? pair.b : pair.a;
    const opp = players.find((p) => p.id === oppId);
    if (!opp) continue;

    if (Math.abs(margin) > Math.abs(biggestMargin)) {
      biggestMargin = margin;
      biggestOppName = opp.name;
      beatOpp = margin > 0;
    }
  }

  const marginAbs = Math.abs(biggestMargin).toFixed(1);
  const expected = myPairs.length > 0
    ? myPairs.reduce((sum, p) => {
        const isA = p.a === viewerId;
        return sum + (isA ? p.expected : 1 - p.expected);
      }, 0) / myPairs.length
    : 0.5;

  const expectedLabel =
    expected > 0.7 ? t("the model expected you to win comfortably")
    : expected > 0.55 ? t("you were favoured to win")
    : expected > 0.45 ? t("the model expected a near coin-flip")
    : expected > 0.3 ? t("you were the underdog")
    : t("the model expected you to struggle");

  // Sentence 1: the biggest pairing result
  let s1: string;
  if (biggestOppName) {
    if (beatOpp) {
      s1 = t("You beat {name} by {n} strokes.", { name: biggestOppName, n: marginAbs });
    } else {
      s1 = t("You lost to {name} by {n} strokes.", { name: biggestOppName, n: marginAbs });
    }
  } else {
    s1 = t("Your rating moved {sign}{n}.", { sign: deltaSign, n: deltaAbs });
  }

  // Sentence 2: expected outcome and delta
  const kVal = snap.k || k;
  const capLabel = expectedLabel.charAt(0).toUpperCase() + expectedLabel.slice(1);
  let s2: string;
  if (beatOpp) {
    if (expected > 0.65) {
      s2 = t("{label}, so this was worth +{n} — modest for the margin.", { label: capLabel, n: deltaAbs });
    } else {
      s2 = t("{label}, so this was worth +{n}.", { label: capLabel, n: deltaAbs });
    }
  } else {
    if (expected < 0.35) {
      s2 = t("{label}, so the rating change was small: −{n}.", { label: capLabel, n: deltaAbs });
    } else {
      s2 = t("{label}, so this cost −{n}.", { label: capLabel, n: deltaAbs });
    }
  }

  // Sentence 3 (optional): recent form
  let s3 = "";
  if (recentDeltas.length >= 3) {
    const beaten = recentDeltas.filter((d) => d > 0).length;
    const total = recentDeltas.length;
    if (beaten >= Math.ceil(total * 0.75)) {
      s3 = t("{beaten} of your last {total} rounds have beaten expectation.", { beaten, total });
    } else if (beaten <= Math.floor(total * 0.25)) {
      s3 = t("{missed} of your last {total} rounds have missed expectation.", { missed: total - beaten, total });
    }
  }

  return [s1, s2, s3].filter(Boolean).join(" ");
}

/**
 * AI-powered narration.
 *
 * Calls an LLM endpoint with the structured round data.  The LLM
 * receives already-computed values and renders them — it never
 * computes a rating.
 *
 * Returns null if AI is unavailable or the call fails, so the
 * caller falls back to the template.
 */
export async function generateAINarration(
  input: NarrationInput,
  aiEndpoint: string
): Promise<string | null> {
  const { round, players, viewerId, recentDeltas, k } = input;

  // Build the structured prompt — every number is pre-computed.
  const viewer = players.find((p) => p.id === viewerId);
  if (!viewer) return null;

  const snap = round.snapshot.find((s) => s.playerId === viewerId);
  if (!snap) return null;

  const pairs = round.pairs.filter(
    (p) => p.a === viewerId || p.b === viewerId
  );

  const pairData = pairs.map((pair) => {
    const isA = pair.a === viewerId;
    const oppId = isA ? pair.b : pair.a;
    const opp = players.find((p) => p.id === oppId);
    const margin = isA ? pair.margin : -pair.margin;
    return {
      opponent: opp?.name ?? oppId,
      opponentRating: Math.round(opp?.rating ?? 0),
      margin: Number(margin.toFixed(2)),
      expected: Number((isA ? pair.expected : 1 - pair.expected).toFixed(3)),
      actual: Number((isA ? pair.score : 1 - pair.score).toFixed(3)),
    };
  });

  const payload = {
    viewerRating: Math.round(viewer.rating),
    delta: Number(snap.delta.toFixed(2)),
    k: snap.k || k,
    playerCount: round.snapshot.length,
    pairs: pairData,
    recentDeltas: recentDeltas.map((d) => Number(d.toFixed(2))),
    format: round.format,
    course: round.course,
    date: round.date,
    instructions:
      "Write 2–3 sentences of plain, warm English narrating this round. " +
      "State only the numbers given here — never compute or invent. " +
      "Be factual and encouraging without being congratulatory about bad rounds. " +
      "Do not mention Elo, K-factors, alpha, or expected scores.",
  };

  try {
    const res = await fetch(aiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.text ?? null;
  } catch {
    return null;
  }
}

/**
 * Main narration entry point.
 *
 * If AI is enabled (endpoint provided), calls the LLM.  If it fails
 * or AI is disabled, falls back to the template generator.
 *
 * The result is meant to be stored on the round record at commit
 * time and never regenerated on view.
 */
export async function generateNarration(
  input: NarrationInput,
  aiEndpoint?: string
): Promise<NarrationResult> {
  const generatedAt = new Date().toISOString();

  if (aiEndpoint) {
    const aiText = await generateAINarration(input, aiEndpoint);
    if (aiText) {
      return { text: aiText, source: "ai", generatedAt };
    }
  }

  return {
    text: generateTemplateNarration(input),
    source: "template",
    generatedAt,
  };
}
