// Anomaly detection — pure, dependency-free statistical checks run against a
// single player's own history. Every check is self-relative (a player is only
// compared against their own recent form, never against opponents), so the
// detector flags inconsistency, not weakness or strength.

export interface StrokeRoundEntry {
  roundId: string;
  ags: number;
  date: string;
  course: string;
}

export interface RatingDeltaEntry {
  roundId: string;
  delta: number;
  date: string;
  course: string;
}

export interface DetectedAnomaly {
  roundId: string;
  reason: string;
  severity: "low" | "medium" | "high";
}

/**
 * Flags two kinds of self-relative outliers:
 *
 *  1. A score more than 2 standard deviations better (lower AGS) than the
 *     player's trailing 5-round average — the "suddenly playing far better
 *     than your own recent form" signal (severity escalates past 3 std dev).
 *  2. A rating gain more than 3x the player's typical per-round swing
 *     magnitude, and more than 10 points — the "one round undid a lot of
 *     banked sandbagging" signal.
 *
 * `strokeRounds` must be the player's own stroke/stableford-format rounds,
 * chronological. `ratingDeltas` must be the player's own signed rating delta
 * per round, chronological.
 */
export function detectAnomalies(
  playerName: string,
  strokeRounds: StrokeRoundEntry[],
  ratingDeltas: RatingDeltaEntry[]
): DetectedAnomaly[] {
  const anomalies: DetectedAnomaly[] = [];

  if (strokeRounds.length >= 5) {
    const recent5 = strokeRounds.slice(-5);
    const agsValues = recent5.map((r) => r.ags);
    const meanAGS = agsValues.reduce((a, b) => a + b, 0) / agsValues.length;
    const variance =
      agsValues.reduce((sum, v) => sum + (v - meanAGS) ** 2, 0) / agsValues.length;
    const stdDev = Math.sqrt(variance);

    for (const r of strokeRounds) {
      if (r.ags < meanAGS - 2 * stdDev) {
        anomalies.push({
          roundId: r.roundId,
          reason: `${playerName} 在 ${r.date} 于 ${r.course} 打出 ${r.ags} 杆，明显低于近期平均 ${Math.round(meanAGS)} 杆（标准差 ${Math.round(stdDev)}）。`,
          severity: r.ags < meanAGS - 3 * stdDev ? "high" : "medium",
        });
      }
    }
  }

  if (ratingDeltas.length >= 5) {
    const typicalGain =
      ratingDeltas.reduce((sum, d) => sum + Math.abs(d.delta), 0) / ratingDeltas.length;

    for (const d of ratingDeltas) {
      if (
        d.delta > typicalGain * 3 &&
        d.delta > 10 &&
        !anomalies.some((a) => a.roundId === d.roundId)
      ) {
        anomalies.push({
          roundId: d.roundId,
          reason: `${playerName} 在 ${d.date} 于 ${d.course} 的这轮球中评分上涨了 ${Math.round(d.delta)} 分——是平时涨幅 ${Math.round(typicalGain)} 的 3 倍以上。`,
          severity: d.delta > typicalGain * 5 ? "high" : "medium",
        });
      }
    }
  }

  return anomalies;
}
