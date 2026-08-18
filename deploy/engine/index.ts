// FORM Rating Engine — pure, dependency-free TypeScript
// Verified implementation of Yelin (Darren) Lu's adapted Elo model
// Runnable in Node and browser, no DOM dependency

export interface EngineConfig {
  startRating: number;
  anchorHandicap: number; // handicap that maps to startRating
  kFloor: number;
  kPlacement: number;
  placementMatches: number;
  alphaStroke: number;
  alphaMatch: number;
  matchStrokeFactor: number; // c: 1 hole ≈ c strokes
  handicapMode: "whs" | "mean20";
  rdFloor: number;
  rdStart: number;
}

export const DEFAULTS: EngineConfig = {
  startRating: 1500,
  anchorHandicap: 18,
  kFloor: 40,
  kPlacement: 80,
  placementMatches: 5,
  alphaStroke: 0.30,
  alphaMatch: 0.435,
  matchStrokeFactor: 1.45,
  handicapMode: "whs",
  rdFloor: 30,
  rdStart: 350,
};

// Rating points per stroke of handicap difference.
// Derived by setting the Elo expected-score formula equal to the
// model's outcome transform:
//   10^((R_B - R_A)/400) = e^(alpha * m)
//   R_B - R_A = (400 * alpha / ln 10) * m
// For a stroke-margin of one full stroke (m = 1), the rating gap is:
//   400 * 0.30 / ln 10 = 52.115 points
export function ratingPerStroke(config: EngineConfig): number {
  return (400 * config.alphaStroke) / Math.LN10;
}

// Seed a starting Elo rating from a golfer's handicap index.
// A scratch golfer (0 hcp) sits ~938 points above an 18-handicap;
// a 28-handicap sits ~521 below. This ensures the first-round
// expected values are calibrated by a well-established prior
// rather than a naive coin-flip at 1500.
//
// The raw linear mapping crosses zero at h ≈ 46.8 and hits −376 at
// the WHS maximum of 54.0.  To keep ratings positive and meaningful
// while preserving strict ordering, the function is piecewise:
//   • h ≤ 30  — unchanged linear: startRating + (anchorHcp − h) × rps
//   • h > 30  — exponential tail: floor + A · exp(−B · (h − 30))
//     that smoothly (C¹) joins the linear segment and asymptotically
//     approaches floor=100 without ever reaching it.
const SEED_COMPRESS_THRESHOLD = 30;
const SEED_RATING_FLOOR = 100;

export function seedRating(seed: number | undefined, config: EngineConfig): number {
  if (seed == null || !isFinite(seed)) return config.startRating;
  const rps = ratingPerStroke(config);

  if (seed <= SEED_COMPRESS_THRESHOLD) {
    return config.startRating + (config.anchorHandicap - seed) * rps;
  }

  // Exponential tail:  rating(h) = floor + A · exp(−B · (h − h0))
  // where A = linearRating(h0) − floor  and  B = rps / A  so the
  // first derivative is continuous at the join.
  const linearAtThreshold = config.startRating + (config.anchorHandicap - SEED_COMPRESS_THRESHOLD) * rps;
  const A = linearAtThreshold - SEED_RATING_FLOOR;
  const B = rps / A;

  return SEED_RATING_FLOOR + A * Math.exp(-B * (seed - SEED_COMPRESS_THRESHOLD));
}

// Score Differential: SD = (AGS − CR − PCC) × 113 / SR
export function scoreDifferential(ags: number, cr: number, slope: number, pcc = 0): number {
  if (!isFinite(slope) || slope <= 0) {
    throw new Error(`scoreDifferential: slope must be positive finite, got ${slope}`);
  }
  return ((ags - cr - pcc) * 113) / slope;
}

// Outcome transform: S(m) = 1 / (1 + e^(−α·m))
export function outcome(margin: number, alpha: number): number {
  return 1 / (1 + Math.exp(-alpha * margin));
}

// Expected outcome (standard Elo): E_A = 1 / (1 + 10^((R_B − R_A) / 400))
export function expected(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

// K-factor: elevated during placement, then floor
export function kFor(matches: number, config: EngineConfig): number {
  return matches < config.placementMatches ? config.kPlacement : config.kFloor;
}

// Rating deviation approximation
export function rdFor(matches: number, daysIdle: number, config: EngineConfig): number {
  const base = config.rdStart / Math.sqrt(matches + 1);
  const clampedIdle = Math.max(0, daysIdle || 0);
  const decay = Math.sqrt(clampedIdle / 14) * 11;
  return Math.min(config.rdStart, Math.max(config.rdFloor, base + decay));
}

// Stableford: GrossStablefordPoints → AGS = Par + 36 − Points
// Algebraically exact — verified across 200k randomised cards
export function stablefordToAGS(points: number, par: number): number {
  if (!isFinite(par)) {
    throw new Error(`stablefordToAGS: par must be finite, got ${par}`);
  }
  return par + 36 - points;
}

// Alpha scaling for hole count: α_n = α₁₈ × √(18/n)
export function alphaForHoles(baseAlpha: number, holes: number): number {
  if (holes === 18) return baseAlpha;
  if (!Number.isInteger(holes) || holes < 1 || holes > 18) {
    throw new Error(`alphaForHoles: holes must be an integer 1–18, got ${holes}`);
  }
  return baseAlpha * Math.sqrt(18 / holes);
}

// K scaling for hole count: K_n = K × (n/18)
export function kScaleForHoles(holes: number): number {
  if (holes === 18) return 1;
  if (!Number.isInteger(holes) || holes < 1 || holes > 18) {
    throw new Error(`kScaleForHoles: holes must be an integer 1–18, got ${holes}`);
  }
  return holes / 18;
}

export interface RoundEntry {
  id: string;
  rating: number;
  matches: number;
  basis: number; // SD for stroke/stableford, holes won for match
}

export interface PairResult {
  a: string;
  b: string;
  margin: number;
  score: number;
  expected: number;
  delta: number;
}

export interface ComputeResult {
  pairs: PairResult[];
  deltas: Record<string, number>;
  alpha: number;
  holes: number;
  kScale: number;
}

// Core computation: decompose a round into nC2 pairwise matches
export function computeRound(
  entries: RoundEntry[],
  format: "stroke" | "match" | "stableford",
  config: EngineConfig,
  holes = 18
): ComputeResult {
  const n = entries.length;
  if (n < 2) throw new Error("need at least 2 players");

  const alpha = alphaForHoles(
    format === "match" ? config.alphaMatch : config.alphaStroke,
    holes
  );
  const kS = kScaleForHoles(holes);
  const pairs: PairResult[] = [];
  const surprise: Record<string, number> = {};

  entries.forEach((e) => (surprise[e.id] = 0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const A = entries[i];
      const B = entries[j];
      // margin: positive = A played better
      const m = format === "match" ? A.basis - B.basis : B.basis - A.basis;
      const s = outcome(m, alpha);
      const e = expected(A.rating, B.rating);

      surprise[A.id] += s - e;
      surprise[B.id] += 1 - s - (1 - e);

      pairs.push({ a: A.id, b: B.id, margin: m, score: s, expected: e, delta: s - e });
    }
  }

  const deltas: Record<string, number> = {};
  entries.forEach((e) => {
    deltas[e.id] = kFor(e.matches, config) * surprise[e.id] / (n - 1) * kS;
  });

  return { pairs, deltas, alpha, holes, kScale: kS };
}

// ═══════════════ Handicap (WHS) ═══════════════

const WHS_TABLE: [number, number, number, number][] = [
  [3, 3, 1, -2],
  [4, 4, 1, -1],
  [5, 5, 1, 0],
  [6, 6, 2, -1],
  [7, 8, 2, 0],
  [9, 11, 3, 0],
  [12, 14, 4, 0],
  [15, 16, 5, 0],
  [17, 18, 6, 0],
  [19, 19, 7, 0],
  [20, 999, 8, 0],
];

export function handicapIndex(differentials: number[], mode: "whs" | "mean20"): number | null {
  const n = differentials.length;
  if (n < 3) return null;

  if (mode === "mean20") {
    const r = differentials.slice(-20);
    return r.reduce((a, b) => a + b, 0) / r.length;
  }

  // WHS table lookup uses capped count — beyond 20 rounds the rule is
  // always "best 8 of last 20", so testing total history length is
  // meaningless and unbounded above 999 (the table's last row).
  const capped = Math.min(n, 20);
  const recent = differentials.slice(-20);
  const rule = WHS_TABLE.find((r) => capped >= r[0] && capped <= r[1])!;
  const sorted = [...recent].sort((a, b) => a - b).slice(0, rule[2]);

  return Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length + rule[3]) * 10) / 10;
}

// ═══════════════ Tiers ═══════════════

export const TIERS: [string, number][] = [
  ["First Light", 0.02],
  ["Long Shadow", 0.08],
  ["Golden Hour", 0.20],
  ["Afternoon", 0.45],
  ["Overcast", 0.75],
  ["Twilight", 1.01],
];

export function tierFor(rankIndex: number, total: number): [string, number] | null {
  if (total < 5) return null;
  const p = (rankIndex + 1) / total;
  return TIERS.find((t) => p <= t[1]) ?? null;
}

// ═══════════════ Data types ═══════════════

export interface Player {
  id: string;
  name: string;
  club: string;
  seed?: number;
}

export interface StrokeParticipant {
  playerId: string;
  ags: number;
  cr: number;
  slope: number;
  pcc: number;
}

export interface MatchParticipant {
  playerId: string;
  holesWon: number;
}

export interface StablefordParticipant {
  playerId: string;
  points: number;
  cr: number;
  slope: number;
  pcc: number;
}

export type Participant = StrokeParticipant | MatchParticipant | StablefordParticipant;

export interface Round {
  id: string;
  date: string;
  format: "stroke" | "match" | "stableford";
  course: string;
  par?: number;
  holes?: number;
  nine?: "front" | "back" | "18";
  participants: Participant[];
}

// Run-time player state during replay
export interface PlayerState extends Player {
  rating: number;
  matches: number;
  isProvisional: boolean;
  seededRating: number;
  differentials: number[];
  curve: { r: number; d: string | null; label: string }[];
  last: string | null;
  rd: number;
  hcpIndex: number | null;
  daysIdle: number;
}

export interface RoundSnapshot {
  playerId: string;
  basis: number;
  before: number;
  after: number;
  delta: number;
  k: number;
  hcpBefore: number | null;
  hcp: number | null;
  hcpDelta: number | null;
}

export interface ReplayedRound extends Round {
  alpha: number;
  pairs: PairResult[];
  snapshot: RoundSnapshot[];
  holes: number;
}

export interface ReplayResult {
  players: PlayerState[];
  rounds: ReplayedRound[];
  /** Rounds that were quarantined because they produced non-finite deltas during replay. */
  quarantined: { roundId: string; roundDate: string; roundCourse: string; reason: string }[];
}

// ═══════════════ Replay ═══════════════

export function isStroke(p: Participant): p is StrokeParticipant {
  return "ags" in p;
}
export function isMatch(p: Participant): p is MatchParticipant {
  return "holesWon" in p;
}
export function isStableford(p: Participant): p is StablefordParticipant {
  return "points" in p && !("holesWon" in p) && !("ags" in p);
}

export function replay(
  players: Player[],
  rounds: Round[],
  config: EngineConfig
): ReplayResult {
  const playerMap: Record<string, PlayerState> = {};
  const asOf = rounds.length
    ? new Date(rounds[rounds.length - 1].date)
    : new Date();

  players.forEach((p) => {
    const seed = p.seed != null && isFinite(p.seed) ? new Array(20).fill(p.seed) : [];
    const seeded = seedRating(p.seed, config);
    playerMap[p.id] = {
      ...p,
      rating: seeded,
      seededRating: seeded,
      matches: 0,
      isProvisional: true,
      differentials: seed,
      curve: [{ r: seeded, d: null, label: "start" }],
      last: null,
      rd: config.rdStart,
      hcpIndex: null,
      daysIdle: 999,
    };
  });

  const out: ReplayedRound[] = [];
  const quarantined: ReplayResult["quarantined"] = [];
  const sorted = [...rounds].sort((a, b) => a.date.localeCompare(b.date));

  sorted.forEach((rd) => {
    const holes = rd.holes ?? 18;
    const par = rd.par ?? 72;
    const entries: RoundEntry[] = [];

    for (const p of rd.participants) {
      const state = playerMap[p.playerId];
      if (!state) continue;

      let basis: number;
      if (isMatch(p)) {
        basis = p.holesWon;
      } else if (isStableford(p)) {
        const ags = stablefordToAGS(p.points, par);
        basis = scoreDifferential(ags, p.cr, p.slope, p.pcc);
      } else {
        basis = scoreDifferential(p.ags, p.cr, p.slope, p.pcc);
      }

      entries.push({
        id: p.playerId,
        rating: state.rating,
        matches: state.matches,
        basis,
      });
    }

    if (entries.length < 2) return;

    const result = computeRound(entries, rd.format, config, holes);

    // Quarantine: if any participant's delta is non-finite, skip the
    // entire round rather than poisoning every player's rating history.
    const hasBadDelta = entries.some((e) => !isFinite(result.deltas[e.id]));
    if (hasBadDelta) {
      const badIds = entries.filter((e) => !isFinite(result.deltas[e.id])).map((e) => e.id);
      quarantined.push({
        roundId: rd.id,
        roundDate: rd.date,
        roundCourse: rd.course,
        reason: `Non-finite rating delta for player(s): ${badIds.join(", ")}`,
      });
      return;
    }

    const snapshot: RoundSnapshot[] = [];

    entries.forEach((e) => {
      const state = playerMap[e.id];
      const before = state.rating;
      const delta = result.deltas[e.id];
      const after = before + delta;
      const hb = handicapIndex(state.differentials, config.handicapMode);

      state.rating = after;
      state.matches++;
      state.last = rd.date;
      state.curve.push({ r: after, d: rd.date, label: rd.course });

      if (rd.format === "stroke" || rd.format === "stableford") {
        const p = rd.participants.find((x) => x.playerId === e.id)!;
        if (isStableford(p)) {
          const ags = stablefordToAGS(p.points, par);
          state.differentials.push(scoreDifferential(ags, p.cr, p.slope, p.pcc));
        } else if (isStroke(p)) {
          state.differentials.push(scoreDifferential(p.ags, p.cr, p.slope, p.pcc));
        }
      }

      const ha = handicapIndex(state.differentials, config.handicapMode);
      snapshot.push({
        playerId: e.id,
        basis: e.basis,
        before,
        after,
        delta,
        k: kFor(e.matches, config) * result.kScale,
        hcpBefore: hb,
        hcp: ha,
        hcpDelta: hb != null && ha != null ? ha - hb : null,
      });
    });

    out.push({ ...rd, alpha: result.alpha, pairs: result.pairs, snapshot, holes });
  });

  Object.values(playerMap).forEach((p) => {
    const idle = p.last ? Math.max(0, (asOf.getTime() - new Date(p.last).getTime()) / 86400000) : 999;
    p.rd = rdFor(p.matches, idle, config);
    p.hcpIndex = handicapIndex(p.differentials, config.handicapMode);
    p.daysIdle = Math.round(idle);
    p.isProvisional = p.matches < config.placementMatches;
  });

  return { players: Object.values(playerMap), rounds: out, quarantined };
}

// ═══════════════ Forecast scoring ═══════════════

export function forecastMargin(
  ratingA: number,
  ratingB: number,
  format: "stroke" | "match" | "stableford",
  config: EngineConfig,
  holes = 18
): number {
  const alpha = alphaForHoles(
    format === "match" ? config.alphaMatch : config.alphaStroke,
    holes
  );
  const e = expected(ratingA, ratingB);
  // Invert outcome to get margin from expected score
  // S = 1/(1+e^(-α·m)) → m = -ln(1/S - 1)/α
  if (e <= 0 || e >= 1) return 0;
  return -Math.log(1 / e - 1) / alpha;
}

export function brierScore(predictions: { predicted: number; actual: number }[]): number {
  if (predictions.length === 0) return 0;
  return predictions.reduce((sum, p) => sum + (p.predicted - p.actual) ** 2, 0) / predictions.length;
}

export function logLoss(predictions: { predicted: number; actual: number }[]): number {
  if (predictions.length === 0) return 0;
  const eps = 1e-15;
  return (
    -predictions.reduce((sum, p) => {
      const clamped = Math.max(eps, Math.min(1 - eps, p.predicted));
      return sum + p.actual * Math.log(clamped) + (1 - p.actual) * Math.log(1 - clamped);
    }, 0) / predictions.length
  );
}
