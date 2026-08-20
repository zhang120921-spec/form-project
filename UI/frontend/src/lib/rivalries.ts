// Rivalries — pairwise records computed from the engine's replay data.
//
// The engine already produces pairwise results in every round's
// `pairs` array.  This module aggregates those into per-pair records
// for connected players who have met at least three times.
//
// The predicted edge is expressed in strokes, derived from the live
// rating gap via the same ratingPerStroke formula as the fair-match
// calculator — never as a probability, always in the reader's language.

import { ratingPerStroke, DEFAULTS, type EngineConfig, type PlayerState, type ReplayedRound, type ReplayResult } from "@engine/index.ts";
import { t } from "./i18n";

export interface Meeting {
  date: string;
  course: string;
  /** Player A's margin vs B in that round (positive = A beat B). */
  margin: number;
  /** "A" or "B" — who won this individual pairing. */
  winner: "A" | "B";
}

export interface RivalryRecord {
  /** Player A is always the viewer; B is the opponent. */
  playerA: { id: string; name: string; rating: number };
  playerB: { id: string; name: string; rating: number };
  meetings: Meeting[];
  /** From A's perspective: wins - losses. */
  wins: number;
  losses: number;
  /** Current streak from A's perspective: positive = winning streak, negative = losing streak. */
  currentStreak: number;
  /** Longest winning streak from A's perspective. */
  longestWinStreak: number;
  /** Longest losing streak from A's perspective. */
  longestLossStreak: number;
  /** Biggest single-round margin (absolute value). */
  biggestMargin: number;
  /** Who had the biggest margin. */
  biggestMarginWinner: "A" | "B";
  /** Sum of all margins from A's perspective (positive = A leads aggregate). */
  aggregateMargin: number;
  /** Predicted edge in strokes for A vs B on current form. */
  predictedEdge: number;
  /** True if A is predicted to win. */
  aIsFavoured: boolean;
}

export interface Milestone {
  type: "took_lead" | "broke_streak" | "biggest_margin";
  description: string;
  date: string;
}

/**
 * Extract all pairwise meetings from replay data.
 * Returns a map keyed by "idA|idB" (always sorted alphabetically).
 */
function extractPairwiseMeetings(
  rounds: ReplayedRound[],
  playerMap: Map<string, PlayerState>
): Map<string, Meeting[]> {
  const meetings = new Map<string, Meeting[]>();

  for (const round of rounds) {
    for (const pair of round.pairs) {
      const [aId, bId] = [pair.a, pair.b].sort();
      const key = `${aId}|${bId}`;
      if (!meetings.has(key)) meetings.set(key, []);

      const aState = playerMap.get(pair.a);
      const bState = playerMap.get(pair.b);
      if (!aState || !bState) continue;

      // In stroke format, margin = B.basis - A.basis.
      // Positive margin = A played better (lower score).
      // The winner is the one with the better (lower for stroke) basis.
      const isA = pair.a === aId;
      const margin = isA ? pair.margin : -pair.margin;
      const winner = margin > 0 ? "A" : "B";

      meetings.get(key)!.push({
        date: round.date,
        course: round.course,
        margin,
        winner,
      });
    }
  }

  return meetings;
}

/**
 * Compute a rivalry record from A's perspective.
 * A is always the viewer, B is the opponent.
 */
export function computeRivalry(
  playerA: PlayerState,
  playerB: PlayerState,
  meetings: Meeting[],
  config: EngineConfig = DEFAULTS
): RivalryRecord {
  const sorted = [...meetings].sort((a, b) => a.date.localeCompare(b.date));

  let wins = 0;
  let losses = 0;
  let currentStreak = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let biggestMargin = 0;
  let biggestMarginWinner: "A" | "B" = "A";
  let aggregateMargin = 0;

  for (const m of sorted) {
    if (m.winner === "A") {
      wins++;
      currentStreak = currentStreak >= 0 ? currentStreak + 1 : 1;
      longestWinStreak = Math.max(longestWinStreak, currentStreak);
    } else {
      losses++;
      currentStreak = currentStreak <= 0 ? currentStreak - 1 : -1;
      longestLossStreak = Math.max(longestLossStreak, -currentStreak);
    }

    const absMargin = Math.abs(m.margin);
    if (absMargin > biggestMargin) {
      biggestMargin = absMargin;
      biggestMarginWinner = m.winner;
    }

    aggregateMargin += m.margin;
  }

  const rps = ratingPerStroke(config);
  const ratingGap = playerA.rating - playerB.rating;
  const predictedEdge = ratingGap / rps;
  const aIsFavoured = predictedEdge > 0;

  return {
    playerA: { id: playerA.id, name: playerA.name, rating: playerA.rating },
    playerB: { id: playerB.id, name: playerB.name, rating: playerB.rating },
    meetings: sorted,
    wins,
    losses,
    currentStreak,
    longestWinStreak,
    longestLossStreak,
    biggestMargin,
    biggestMarginWinner,
    aggregateMargin,
    predictedEdge,
    aIsFavoured,
  };
}

/**
 * Build all rivalry records for a given viewer from replay data.
 * Only includes pairs that have met at least `minMeetings` times.
 */
export function buildRivalries(
  replay: ReplayResult,
  viewerId: string,
  config: EngineConfig = DEFAULTS,
  minMeetings = 3
): RivalryRecord[] {
  const playerMap = new Map(replay.players.map((p) => [p.id, p]));
  const allMeetings = extractPairwiseMeetings(replay.rounds, playerMap);

  const rivalries: RivalryRecord[] = [];

  for (const [key, meetings] of allMeetings) {
    if (meetings.length < minMeetings) continue;

    const [aId, bId] = key.split("|");
    // Only include pairs involving the viewer.
    if (aId !== viewerId && bId !== viewerId) continue;

    const playerA = playerMap.get(viewerId)!;
    const otherId = aId === viewerId ? bId : aId;
    const playerB = playerMap.get(otherId);
    if (!playerB) continue;

    // Flip meetings so margin is from A's perspective.
    const aMeetings = meetings.map((m) => {
      const isViewerA =
        (aId === viewerId && m.winner === "A") ||
        (bId === viewerId && m.winner === "B");
      // Original meetings have A = aId (sorted), B = bId.
      // If viewer is bId, flip the margin.
      const viewerMargin = aId === viewerId ? m.margin : -m.margin;
      return {
        ...m,
        margin: viewerMargin,
        winner: isViewerA ? "A" as const : "B" as const,
      };
    });

    rivalries.push(computeRivalry(playerA, playerB, aMeetings, config));
  }

  // Sort by number of meetings (most-played first).
  rivalries.sort((a, b) => b.meetings.length - a.meetings.length);

  return rivalries;
}

/**
 * Detect milestones from a new meeting.
 *
 * Only fires for:
 *   - Taking the lead in a rivalry for the first time in over a month
 *   - Breaking a losing streak of three or more
 *   - Setting a new biggest margin
 *
 * Returns an empty array for an ordinary single result.
 */
export function detectMilestones(
  before: RivalryRecord,
  after: RivalryRecord,
  newMeeting: Meeting
): Milestone[] {
  const milestones: Milestone[] = [];

  // 1. Taking the lead for the first time in over a month
  const beforeLead = before.wins - before.losses;
  const afterLead = after.wins - after.losses;
  if (beforeLead <= 0 && afterLead > 0) {
    // Check if the previous lead was over a month ago
    // Find the last time A was ahead
    let lastLeadIndex = -1;
    let runningTally = 0;
    for (let i = 0; i < before.meetings.length; i++) {
      if (before.meetings[i].winner === "A") runningTally++;
      else runningTally--;
      if (runningTally > 0) lastLeadIndex = i;
    }

    const isOverMonth =
      lastLeadIndex === -1 ||
      new Date(newMeeting.date).getTime() -
        new Date(before.meetings[lastLeadIndex].date).getTime() >
        30 * 86400000;

    if (isOverMonth) {
      milestones.push({
        type: "took_lead",
        description: t("You've taken the lead against {name} for the first time in over a month.", { name: after.playerB.name }),
        date: newMeeting.date,
      });
    }
  }

  // 2. Breaking a losing streak of three or more
  if (before.currentStreak <= -3 && after.currentStreak > 0) {
      milestones.push({
        type: "broke_streak",
        description: t("You broke a {n}-match losing streak against {name}.", { n: -before.currentStreak, name: after.playerB.name }),
        date: newMeeting.date,
      });
  }

  // 3. Setting a new biggest margin
  if (
    Math.abs(newMeeting.margin) > before.biggestMargin &&
    newMeeting.winner === "A"
  ) {
      milestones.push({
        type: "biggest_margin",
        description: t("You set a new biggest margin against {name}: {n} strokes.", { name: after.playerB.name, n: Math.abs(newMeeting.margin).toFixed(1) }),
        date: newMeeting.date,
      });
  }

  return milestones;
}

/**
 * Format the rivalry record as shareable plain text.
 */
export function rivalryToText(r: RivalryRecord): string {
  const streak =
    r.currentStreak > 0
      ? t("on a {n}-match winning streak", { n: r.currentStreak })
      : r.currentStreak < 0
        ? t("on a {n}-match losing streak", { n: -r.currentStreak })
        : t("even in the last match");

  const edge = Math.abs(r.predictedEdge);
  const edgeN = Math.round(edge);
  const strokeWord = edgeN === 1 ? t("stroke") : t("strokes");
  const edgeText =
    edge < 0.5
      ? t("dead even on current form")
      : r.aIsFavoured
        ? t("you'd expect to beat {name} by about {n} {strokeWord}", { name: r.playerB.name, n: edgeN, strokeWord })
        : t("{name} would be favoured by about {n} {strokeWord}", { name: r.playerB.name, n: edgeN, strokeWord });

  return t("{a} vs {b}: {wins}–{losses}, {streak}. On current form, {edge}.", { a: r.playerA.name, b: r.playerB.name, wins: r.wins, losses: r.losses, streak, edge: edgeText });
}
