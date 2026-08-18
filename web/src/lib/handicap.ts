/**
 * Parse a handicap index string using golf's plus-handicap convention.
 *
 * In golf, a "+" prefix means the player is better than scratch.
 * "+2" denotes a handicap index of -2.0, which seeds above scratch.
 *
 * Rules:
 *   "+2"    → -2.0
 *   "+1.3"  → -1.3
 *   "12.4"  → 12.4
 *   "-2"    → -2.0  (already negative, parsed normally)
 *   ""      → null  (no value supplied)
 *
 * After conversion, validates the WHS range of -10.0 to 54.0.
 */

export interface ParsedHandicap {
  ok: boolean;
  value: number | null;
  error?: string;
}

const MIN_HCP = -10.0;
const MAX_HCP = 54.0;

export function parseHandicap(raw: string): ParsedHandicap {
  const trimmed = raw.trim();

  if (trimmed === "") {
    return { ok: true, value: null };
  }

  let value: number;

  if (trimmed.startsWith("+")) {
    const after = trimmed.slice(1).trim();
    const num = parseFloat(after);
    if (isNaN(num) || !isFinite(num)) {
      return { ok: false, value: null, error: "Invalid handicap: cannot parse the value after +" };
    }
    value = -num || 0; // avoid -0
  } else {
    const num = parseFloat(trimmed);
    if (isNaN(num) || !isFinite(num)) {
      return { ok: false, value: null, error: `Invalid handicap: "${trimmed}" is not a number` };
    }
    value = num;
  }

  if (value < MIN_HCP || value > MAX_HCP) {
    return {
      ok: false,
      value: null,
      error: `Handicap must be between ${MIN_HCP} and ${MAX_HCP} (got ${value})`,
    };
  }

  return { ok: true, value };
}

/**
 * Format a handicap index for display using the plus convention.
 * -2.0 → "+2.0"
 * 12.4 → "12.4"
 */
export function formatHandicap(hcp: number | null | undefined): string {
  if (hcp == null || !isFinite(hcp)) return "—";
  if (hcp < 0) return `+${Math.abs(hcp).toFixed(1)}`;
  return hcp.toFixed(1);
}
