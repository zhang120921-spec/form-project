// AI Scorecard Capture — three routes for score entry.
//
// CONSTRAINTS (from the spec):
//   1. Both AI routes produce a DRAFT that the user confirms field
//      by field before anything commits.  Never auto-commit.
//   2. Never hide a low-confidence field.  Show per-field confidence,
//      highlight uncertain fields in warning colour.
//   3. An unmatched name prompts the user to pick from their friends
//      list — never silently create a player.
//   4. An implausible score (far outside the player's distribution)
//      is flagged for review before commit.
//   5. An unreadable field is left blank for manual entry — never
//      guessed.
//   6. Preserve the original photograph attached to the round.
//   7. The product works fully with AI disabled — manual entry is
//      the fast fallback that already exists.

import type { FriendInfo } from "@/lib/types";

// ── Types ──────────────────────────────────────────────────

export interface ScoreField {
  /** Player name as read/heard by the AI. */
  rawName: string;
  /** Matched friend ID, if any. null = unmatched. */
  matchedFriendId: string | null;
  /** Gross score as read/heard. null = unreadable. */
  ags: number | null;
  /** Confidence 0–1 for the name match. */
  nameConfidence: number;
  /** Confidence 0–1 for the score read. */
  scoreConfidence: number;
  /** Hole-by-hole scores, if legible. null = not read. */
  holeScores?: (number | null)[] | null;
  /** Flag: true if the score is implausible for this player. */
  implausible?: boolean;
  /** Flag: true if the name was unmatched. */
  unmatched?: boolean;
}

export interface ScorecardDraft {
  fields: ScoreField[];
  /** Course name as parsed. null = not detected. */
  courseName: string | null;
  /** Course confidence 0–1. */
  courseConfidence: number;
  /** Format as parsed. null = default to "stroke". */
  format: "stroke" | "stableford" | "match" | null;
  /** Source image data URL, if photo route. Preserved for the round record. */
  photoDataUrl?: string;
}

export interface ValidationError {
  fieldIndex: number;
  type: "unmatched_name" | "implausible_score" | "missing_score" | "missing_name";
  message: string;
}

export interface ValidationResult {
  errors: ValidationError[];
  canCommit: boolean;
}

// ── Voice parsing ──────────────────────────────────────────

/**
 * Parse a spoken round transcript into a draft.
 *
 * Examples:
 *   "Michael 78, Darren 81, Wei 88 at Serapong"
 *   "Mike shot 82, Darren 79 at Sentosa, stroke play"
 *
 * The parser extracts names, scores, and an optional course name.
 * It does NOT commit anything — the caller must confirm field by field.
 */
export function parseVoiceInput(
  transcript: string,
  friends: FriendInfo[]
): ScorecardDraft {
  const text = transcript.trim();
  if (!text) {
    return { fields: [], courseName: null, courseConfidence: 0, format: null };
  }

  // Try to extract course name (text after "at")
  const atMatch = text.match(/\bat\s+([A-Za-z][A-Za-z\s]+?)(?:\.|$|,)/i);
  const courseName = atMatch ? atMatch[1].trim() : null;
  const courseConfidence = atMatch ? 0.8 : 0;

  // Try to detect format
  let format: ScorecardDraft["format"] = null;
  if (/stableford/i.test(text)) format = "stableford";
  else if (/match\s*play/i.test(text)) format = "match";
  else if (/stroke/i.test(text)) format = "stroke";

  // Remove the course portion for name/score parsing
  const playerText = atMatch ? text.slice(0, atMatch.index).trim() : text;

  // Split by comma or "and" to get player entries
  const entries = playerText
    .split(/,|\sand\s/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const fields: ScoreField[] = [];

  for (const entry of entries) {
    // Match "Name <number>" or "Name shot <number>" or "Name: number"
    const match = entry.match(/^([A-Za-z][A-Za-z\s\-']+?)[\s:]+(?:shot\s+|fired\s+)?(\d{1,3})/i);
    if (!match) continue;

    const rawName = match[1].trim();
    const ags = parseInt(match[2], 10);

    // Match against friends
    const { matchedFriendId, nameConfidence, unmatched } = matchName(rawName, friends);

    fields.push({
      rawName,
      matchedFriendId,
      ags,
      nameConfidence,
      scoreConfidence: 0.9, // voice score reads are fairly reliable
      holeScores: null,
      unmatched,
    });
  }

  return { fields, courseName, courseConfidence, format };
}

// ── Name matching ──────────────────────────────────────────

/**
 * Match a spoken/OCR'd name against the friends list.
 *
 * Uses fuzzy matching: exact, then first-name, then contains.
 * Confidence: 1.0 for exact, 0.85 for first-name, 0.6 for contains,
 * 0.0 for no match.
 */
function matchName(
  rawName: string,
  friends: FriendInfo[]
): { matchedFriendId: string | null; nameConfidence: number; unmatched: boolean } {
  const cleaned = rawName.toLowerCase().trim();

  // Exact match
  for (const f of friends) {
    const fname = (f.displayName ?? f.display_name ?? "").toLowerCase();
    if (fname === cleaned) {
      return { matchedFriendId: f.userId ?? f.id ?? null, nameConfidence: 1.0, unmatched: false };
    }
  }

  // First-name match
  for (const f of friends) {
    const fname = (f.displayName ?? f.display_name ?? "").toLowerCase();
    const parts = fname.split(/\s+/);
    if (parts.length > 0 && parts[0] === cleaned.split(/\s+/)[0]) {
      return { matchedFriendId: f.userId ?? f.id ?? null, nameConfidence: 0.85, unmatched: false };
    }
  }

  // Contains match (partial)
  for (const f of friends) {
    const fname = (f.displayName ?? f.display_name ?? "").toLowerCase();
    if (fname.includes(cleaned) || cleaned.includes(fname)) {
      return { matchedFriendId: f.userId ?? f.id ?? null, nameConfidence: 0.6, unmatched: false };
    }
  }

  // No match — NEVER auto-create
  return { matchedFriendId: null, nameConfidence: 0, unmatched: true };
}

// ── Validation ─────────────────────────────────────────────

/**
 * Validate a draft before commit.
 *
 * Checks:
 *   - Unmatched names → error (must pick from friends list)
 *   - Missing scores → error (must fill in manually)
 *   - Implausible scores → error (must review)
 *
 * canCommit is true ONLY when there are zero errors.
 */
export function validateDraft(
  draft: ScorecardDraft,
  playerDistributions?: Map<string, { mean: number; std: number }>
): ValidationResult {
  const errors: ValidationError[] = [];

  draft.fields.forEach((field, i) => {
    // Unmatched name
    if (field.unmatched || !field.matchedFriendId) {
      errors.push({
        fieldIndex: i,
        type: "unmatched_name",
        message: `"${field.rawName}" doesn't match anyone in your friends list. Pick the right person.`,
      });
    }

    // Missing name
    if (!field.rawName) {
      errors.push({
        fieldIndex: i,
        type: "missing_name",
        message: "This field needs a name. Enter it manually.",
      });
    }

    // Missing score
    if (field.ags == null) {
      errors.push({
        fieldIndex: i,
        type: "missing_score",
        message: "Score couldn't be read. Enter it manually.",
      });
    }

    // Implausible score
    if (field.ags != null && field.matchedFriendId && playerDistributions) {
      const dist = playerDistributions.get(field.matchedFriendId);
      if (dist) {
        const z = Math.abs(field.ags - dist.mean) / (dist.std || 1);
        if (z > 3) {
          errors.push({
            fieldIndex: i,
            type: "implausible_score",
            message: `${field.ags} is unusually ${field.ags > dist.mean ? "high" : "low"} for ${field.rawName}. Please review.`,
          });
        }
      }
    }
  });

  return {
    errors,
    canCommit: errors.length === 0,
  };
}

// ── OCR parsing (stub for vision API) ───────────────────────

/**
 * Parse a scorecard photo via a vision API.
 *
 * In production, this calls a vision model endpoint that returns
 * per-field gross scores with confidence.  The structure is
 * defined here so the UI can be built against it.
 *
 * When AI is disabled, this function is not called — the user
 * falls back to manual entry.
 */
export async function parseScorecardPhoto(
  imageDataUrl: string,
  friends: FriendInfo[],
  visionEndpoint?: string
): Promise<ScorecardDraft> {
  if (!visionEndpoint) {
    throw new Error("Vision API not configured. Use manual entry.");
  }

  try {
    const res = await fetch(visionEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: imageDataUrl,
        friends: friends.map((f) => ({
          id: f.userId ?? f.id,
          name: f.displayName ?? f.display_name,
        })),
        instructions:
          "Read gross scores per player from this scorecard. " +
          "Match names against the provided friends list. " +
          "For each field, return: rawName, ags, nameConfidence, scoreConfidence. " +
          "If a field is unreadable, return null for ags. " +
          "Do not guess any value.",
      }),
    });

    if (!res.ok) throw new Error("Vision API request failed");
    const data = await res.json();

    // Enrich with matched friend IDs
    const fields: ScoreField[] = (data.fields ?? []).map((f: ScoreField) => {
      const { matchedFriendId, nameConfidence, unmatched } = matchName(f.rawName, friends);
      return {
        ...f,
        matchedFriendId,
        nameConfidence: Math.min(f.nameConfidence ?? 0, nameConfidence),
        unmatched,
      };
    });

    return {
      fields,
      courseName: data.courseName ?? null,
      courseConfidence: data.courseConfidence ?? 0,
      format: data.format ?? null,
      photoDataUrl: imageDataUrl,
    };
  } catch {
    throw new Error("Could not read the scorecard. Please try manual entry.");
  }
}

// ── Shareable text ─────────────────────────────────────────

/**
 * Format a confirmed draft as plain text for sharing.
 */
export function draftToText(draft: ScorecardDraft): string {
  const lines = draft.fields.map((f) => {
    const name = f.rawName;
    const score = f.ags ?? "?";
    return `${name} ${score}`;
  });

  const course = draft.courseName ? ` at ${draft.courseName}` : "";
  const fmt = draft.format ? ` (${draft.format})` : "";

  return `${lines.join(", ")}${course}${fmt}`;
}
