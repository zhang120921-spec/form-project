// Connectivity & opponent diversity — plain-language indicators
// derived from the match graph in the replay data.
//
// Ratings are only comparable across a connected match graph.
// This module produces human-readable assessments without any
// graph-theoretic vocabulary.

import type { ReplayResult } from "@/lib/types";
import { t } from "./i18n";

export interface PlayerConnectivity {
  playerId: string;
  /** Unique opponents this player has faced. */
  uniqueOpponents: string[];
  /** Total number of players in the full pool (excluding self). */
  poolSize: number;
  /** Total rounds played. */
  totalRounds: number;
  /** Connectivity label — plain English only. */
  connectivityLabel: string;
  /** Whether the connectivity is a warning (poorly connected). */
  isWarning: boolean;
  /** Opponent diversity warning, or null if diversity is fine. */
  diversityWarning: string | null;
}

/**
 * Build connectivity assessments for every player in the replay data.
 *
 * Connectivity depends on how many distinct opponents a player has
 * faced, relative to the total pool size.  A player who has only
 * played two other people in a 10-player club cannot be compared to
 * the other seven.
 */
export function buildConnectivity(replay: ReplayResult): Map<string, PlayerConnectivity> {
  const { players, rounds } = replay;
  const poolSize = players.length - 1;

  // Build opponent adjacency from all rounds.
  const opponentMap = new Map<string, Set<string>>();
  players.forEach((p) => opponentMap.set(p.id, new Set()));

  for (const round of rounds) {
    const ids = round.snapshot.map((s) => s.playerId);
    // Every pair in this round has played each other.
    for (const a of ids) {
      for (const b of ids) {
        if (a !== b) {
          opponentMap.get(a)?.add(b);
        }
      }
    }
  }

  const result = new Map<string, PlayerConnectivity>();

  for (const player of players) {
    const opponents = [...(opponentMap.get(player.id) ?? [])];
    const unique = opponents.length;
    const roundsPlayed = player.matches;

    // --- Connectivity label ---
    let connectivityLabel: string;
    let isWarning = false;

    if (unique === 0) {
      // No recorded opponents at all — should not happen if they have rounds.
      connectivityLabel = t("No match data yet.");
      isWarning = true;
    } else if (unique >= Math.min(3, poolSize)) {
      connectivityLabel = t("Well connected");
    } else if (unique >= 1) {
      if (poolSize > unique && poolSize >= 3) {
        // They've only played a fraction of the pool.
        const names = opponents.slice(0, 2).map((id) => {
          const p = players.find((pp) => pp.id === id);
          return p?.name ?? t("another player");
        });
        if (poolSize - unique > 2) {
          connectivityLabel = t("You've only played {names}, so we can't compare you to the rest of the club yet.", { names: names.join(" and ") });
          isWarning = true;
        } else {
          connectivityLabel = t("Loosely connected");
        }
      } else {
        connectivityLabel = t("Loosely connected");
      }
    } else {
      connectivityLabel = t("Loosely connected");
    }

    // --- Opponent diversity ---
    let diversityWarning: string | null = null;
    if (roundsPlayed >= 3 && unique <= 2 && unique > 0) {
      diversityWarning =
        unique === 1
          ? t("Most of your rounds are against the same player — play someone new to sharpen your rating.")
          : t("Most of your rounds are against the same two players — play someone new to sharpen your rating.");
    }

    result.set(player.id, {
      playerId: player.id,
      uniqueOpponents: opponents,
      poolSize,
      totalRounds: roundsPlayed,
      connectivityLabel,
      isWarning,
      diversityWarning,
    });
  }

  return result;
}

/**
 * Get connectivity for a single player, or null if unavailable.
 */
export function getConnectivity(
  connectivityMap: Map<string, PlayerConnectivity>,
  playerId: string
): PlayerConnectivity | null {
  return connectivityMap.get(playerId) ?? null;
}
