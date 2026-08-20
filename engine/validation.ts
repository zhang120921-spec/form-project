// Shared round validation — applied on both client before submission
// and server before persistence so the two boundaries cannot drift.
// Pure TypeScript, no dependencies; importable from both engine and web.

export type ValidationError = {
  field: string;
  message: string;
};

export type ValidationResult =
  | { ok: true; data: ValidatedRound }
  | { ok: false; errors: ValidationError[] };

export interface ValidatedParticipant {
  playerId: string;
  ags?: number;
  holesWon?: number;
  points?: number;
  cr: number;
  slope: number;
  pcc: number;
}

export interface ValidatedRound {
  date: string;
  format: "stroke" | "match" | "stableford";
  course: string;
  par: number;
  holes: number;
  nine: "front" | "back" | "18";
  participants: ValidatedParticipant[];
}

const AGS_MIN = 18;
const AGS_MAX = 200;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && isFinite(v);
}

/**
 * Parse a value to a number, rejecting strings that don't cleanly parse.
 * Never coerces silently — "85" → 85 is OK, but "85abc" → NaN is rejected.
 */
function parseNumber(v: unknown, field: string, errors: ValidationError[]): number | undefined {
  if (typeof v === "number") {
    if (!isFinite(v)) {
      errors.push({ field, message: `${field} must be a finite number` });
      return undefined;
    }
    return v;
  }
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") {
      errors.push({ field, message: `${field} must not be empty` });
      return undefined;
    }
    const n = Number(trimmed);
    if (!isFinite(n) || String(n) !== trimmed) {
      errors.push({ field, message: `${field} "${v}" is not a valid number` });
      return undefined;
    }
    return n;
  }
  errors.push({ field, message: `${field} must be a number, got ${typeof v}` });
  return undefined;
}

export function validateRound(raw: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!raw || typeof raw !== "object") {
    return { ok: false, errors: [{ field: "root", message: "Request body must be an object" }] };
  }

  const body = raw as Record<string, unknown>;

  // ── date ──
  const date = typeof body.date === "string" ? body.date : "";
  if (!date) {
    errors.push({ field: "date", message: "Date is required" });
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.push({ field: "date", message: `Date must be YYYY-MM-DD format, got "${date}"` });
  } else {
    // Reject future dates
    const d = new Date(date + "T00:00:00Z");
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (d.getTime() > todayUTC.getTime()) {
      errors.push({ field: "date", message: `Date "${date}" is in the future — cannot log future rounds` });
    }
  }

  // ── format ──
  const format = body.format;
  if (format !== "stroke" && format !== "match" && format !== "stableford") {
    errors.push({ field: "format", message: `Format must be stroke, match, or stableford, got "${format}"` });
  }

  // ── course ──
  const course = typeof body.course === "string" ? body.course.trim() : "";
  if (!course) {
    errors.push({ field: "course", message: "Course is required" });
  } else if (course.length > 200) {
    errors.push({ field: "course", message: "Course name is too long" });
  }

  // ── holes ──
  const holesRaw = body.holes;
  let holes = 18;
  if (holesRaw != null) {
    const parsed = parseNumber(holesRaw, "holes", errors);
    if (parsed !== undefined) {
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 18) {
        errors.push({ field: "holes", message: `Holes must be an integer 1–18, got ${parsed}` });
      } else {
        holes = parsed;
      }
    }
  }

  // ── nine ──
  const nine = body.nine;
  let nineVal: "front" | "back" | "18" = "18";
  if (nine != null) {
    if (nine === "front" || nine === "back" || nine === "18") {
      nineVal = nine;
    } else {
      errors.push({ field: "nine", message: `Nine must be front, back, or 18, got "${nine}"` });
    }
  }

  // ── par ──
  let par: number | undefined;
  if (body.par != null) {
    par = parseNumber(body.par, "par", errors);
  }

  // ── participants ──
  const participantsRaw = body.participants;
  if (!Array.isArray(participantsRaw)) {
    errors.push({ field: "participants", message: "Participants must be an array" });
    return { ok: false, errors };
  }

  if (participantsRaw.length < 2) {
    errors.push({ field: "participants", message: "Need at least 2 participants" });
  }

  const participants: ValidatedParticipant[] = [];

  // Check for duplicate player IDs
  const seenPlayerIds = new Set<string>();
  for (let i = 0; i < participantsRaw.length; i++) {
    const p = participantsRaw[i] as Record<string, unknown>;
    const playerId = typeof p.playerId === "string" ? p.playerId.trim() : "";
    if (!playerId) {
      errors.push({ field: `participants[${i}].playerId`, message: "playerId is required" });
    } else if (seenPlayerIds.has(playerId)) {
      errors.push({ field: `participants[${i}].playerId`, message: `Duplicate player "${playerId}" — each player may appear only once` });
    } else {
      seenPlayerIds.add(playerId);
    }
  }

  for (let i = 0; i < participantsRaw.length; i++) {
    const p = participantsRaw[i] as Record<string, unknown>;
    const prefix = `participants[${i}]`;
    const part: ValidatedParticipant = {
      playerId: typeof p.playerId === "string" ? p.playerId.trim() : "",
      cr: 0,
      slope: 0,
      pcc: 0,
    };

    // ── cr (course rating) ──
    const cr = parseNumber(p.cr, `${prefix}.cr`, errors);
    if (cr !== undefined) {
      if (!isFinite(cr)) {
        errors.push({ field: `${prefix}.cr`, message: "Course rating must be finite" });
      } else {
        part.cr = cr;
      }
    }

    // ── slope ──
    const slope = parseNumber(p.slope, `${prefix}.slope`, errors);
    if (slope !== undefined) {
      if (!isFinite(slope) || slope <= 0) {
        errors.push({ field: `${prefix}.slope`, message: `Slope must be a positive finite number, got ${slope}` });
      } else {
        part.slope = slope;
      }
    }

    // ── pcc ──
    if (p.pcc != null) {
      const pcc = parseNumber(p.pcc, `${prefix}.pcc`, errors);
      if (pcc !== undefined) {
        part.pcc = pcc;
      }
    }

    // ── format-specific fields ──
    if (format === "match") {
      const hw = parseNumber(p.holesWon, `${prefix}.holesWon`, errors);
      if (hw !== undefined) {
        if (!isFinite(hw)) {
          errors.push({ field: `${prefix}.holesWon`, message: "holesWon must be finite" });
        } else if (Math.abs(hw) > holes) {
          errors.push({ field: `${prefix}.holesWon`, message: `Match margin ${hw} exceeds holes played (${holes})` });
        } else {
          part.holesWon = hw;
        }
      }
    } else if (format === "stableford") {
      // Stableford requires par
      if (par === undefined || !isFinite(par)) {
        errors.push({ field: "par", message: "Par is required for stableford format" });
      }

      const pts = parseNumber(p.points, `${prefix}.points`, errors);
      if (pts !== undefined) {
        if (!isFinite(pts) || pts < 0) {
          errors.push({ field: `${prefix}.points`, message: `Points must be a non-negative finite number, got ${pts}` });
        } else {
          part.points = pts;
        }
      }
    } else {
      // stroke
      const ags = parseNumber(p.ags, `${prefix}.ags`, errors);
      if (ags !== undefined) {
        if (!isFinite(ags) || ags < AGS_MIN || ags > AGS_MAX) {
          errors.push({ field: `${prefix}.ags`, message: `AGS must be between ${AGS_MIN} and ${AGS_MAX}, got ${ags}` });
        } else {
          part.ags = ags;
        }
      }
    }

    participants.push(part);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      date,
      format: format as ValidatedRound["format"],
      course,
      par: par ?? 72,
      holes,
      nine: nineVal,
      participants,
    },
  };
}
