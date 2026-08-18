// AI Routes — LLM-enhanced features with rule-based fallbacks
import { Hono } from "hono";
import { z } from "zod";
import crypto from "crypto";
import db from "../db/connection.js";
import { ensureFamousPlayers } from "../db/pros.js";
import { authMiddleware, adminMiddleware, type AppEnv } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { chatCompletion, isAIEnabled, getAIConfig } from "./service.js";
import {
  replay,
  seedRating,
  DEFAULTS,
  type Player,
  type Round,
  type ReplayResult,
} from "../../../engine/index.js";
import { detectAnomalies, type DetectedAnomaly } from "../../../engine/anomaly.js";

const app = new Hono<AppEnv>();
const uid = () => crypto.randomUUID();

// All AI routes require authentication
app.use("*", authMiddleware);

// ═══════════════ Helper: build replay data ═══════════════

function buildReplayData(userId: string) {
  const friendIds = db
    .prepare("SELECT friend_id FROM friendships WHERE user_id = ?")
    .all(userId) as any[];
  const ids = [userId, ...friendIds.map((f: any) => f.friend_id)];
  const placeholders = ids.map(() => "?").join(",");

  const roundRows = db
    .prepare(
      `SELECT DISTINCT r.* FROM rounds r
       JOIN round_participants rp ON r.id = rp.round_id
       WHERE r.status != 'disputed'
       AND rp.player_id IN (${placeholders})
       ORDER BY r.date ASC`
    )
    .all(...ids) as any[];

  const playerIds = new Set<string>([userId]);
  const participantRows: any[] = [];

  for (const r of roundRows) {
    const parts = db
      .prepare("SELECT * FROM round_participants WHERE round_id = ?")
      .all(r.id) as any[];
    for (const p of parts) {
      playerIds.add(p.player_id);
      participantRows.push({
        ...p,
        roundId: r.id,
        format: r.format,
        date: r.date,
        course: r.course,
        par: r.par,
        holes: r.holes,
        nine: r.nine,
      });
    }
  }

  const players: Player[] = [];
  for (const pid of playerIds) {
    const u = db
      .prepare("SELECT id, display_name, home_club, sga_handicap FROM users WHERE id = ?")
      .get(pid) as any;
    if (u) {
      players.push({
        id: u.id,
        name: u.display_name || u.id.slice(0, 6),
        club: u.home_club || "",
        seed: u.sga_handicap ?? undefined,
      });
    }
  }

  const roundMap = new Map<string, Round>();
  for (const pr of participantRows) {
    if (!roundMap.has(pr.roundId)) {
      roundMap.set(pr.roundId, {
        id: pr.roundId,
        date: pr.date,
        format: pr.format,
        course: pr.course,
        par: pr.par || 72,
        holes: pr.holes || 18,
        nine: pr.nine || "18",
        participants: [],
      });
    }
    const round = roundMap.get(pr.roundId)!;
    if (pr.format === "match") {
      round.participants.push({
        playerId: pr.player_id,
        holesWon: pr.holes_won || 0,
      } as any);
    } else if (pr.format === "stableford") {
      round.participants.push({
        playerId: pr.player_id,
        points: pr.points || 0,
        cr: pr.cr,
        slope: pr.slope,
        pcc: pr.pcc || 0,
      } as any);
    } else {
      round.participants.push({
        playerId: pr.player_id,
        ags: pr.ags || 0,
        cr: pr.cr,
        slope: pr.slope,
        pcc: pr.pcc || 0,
      } as any);
    }
  }

  return { players, rounds: [...roundMap.values()] };
}

/** Get player name by ID from the users table. */
function getPlayerName(playerId: string): string {
  const u = db
    .prepare("SELECT display_name FROM users WHERE id = ?")
    .get(playerId) as any;
  return u?.display_name || playerId.slice(0, 8);
}

/** Trim a trailing sentence fragment when the model runs out of tokens.
 *  Keeps text that ends cleanly with sentence punctuation; otherwise cuts
 *  back to the last complete sentence so the UI never shows "...clearly a." */
function trimTrailingFragment(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  // Already ends with sentence-ending punctuation — but guard against lone
  // letter fragments like "a." at the very end.
  if (/[.!?]['"]?\s*$/.test(trimmed)) {
    const match = trimmed.match(/[^.!?]*[.!?]['"]?\s*$/);
    if (match) {
      const fragment = match[0].trim();
      const words = fragment.split(/\s+/);
      const lastWord = words[words.length - 1].replace(/['"]+$/, "");
      if (words.length <= 2 && /^[a-zA-Z]$/.test(lastWord.replace(/\.$/, ""))) {
        const cutAt = trimmed.lastIndexOf(fragment);
        return trimmed.slice(0, cutAt).trim();
      }
    }
    return trimmed;
  }

  // No terminal punctuation — cut back to the last complete sentence.
  const lastComplete = trimmed.match(/^(.*[.!?]['"]?)\s*[^.!?]*$/);
  if (lastComplete) return lastComplete[1].trim();
  return trimmed;
}

// ───── CR Helpers ─────

function expectedOutcome(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

// ═══════════════ 2. AI Narrator ═══════════════

app.post("/narrate", rateLimit(10, 60_000), async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const schema = z.object({ roundId: z.string().min(1) });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400);

  const { roundId } = parsed.data;

  // Verify user is a participant or a friend of a participant in this round
  const friendIds = db
    .prepare("SELECT friend_id FROM friendships WHERE user_id = ?")
    .all(userId) as any[];
  const networkIds = [userId, ...friendIds.map((f: any) => f.friend_id)];
  const placeholders = networkIds.map(() => "?").join(",");
  const isAuthorized = db
    .prepare(
      `SELECT 1 FROM round_participants WHERE round_id = ? AND player_id IN (${placeholders}) LIMIT 1`
    )
    .get(roundId, ...networkIds);
  if (!isAuthorized) return c.json({ error: "Round not found or not authorized" }, 404);

  // Fetch round details
  const roundRow = db.prepare("SELECT * FROM rounds WHERE id = ?").get(roundId) as any;
  if (!roundRow) return c.json({ error: "Round not found" }, 404);

  // Get participants
  const participants = db
    .prepare(
      `SELECT rp.*, u.display_name, u.sga_handicap FROM round_participants rp
       JOIN users u ON rp.player_id = u.id
       WHERE rp.round_id = ?`
    )
    .all(roundId) as any[];

  // Get replay result for context
  const { players, rounds } = buildReplayData(userId);
  const result = replay(players, rounds, DEFAULTS);

  // Find the replayed round
  const replayedRound = result.rounds.find((rr) => rr.id === roundId);
  if (!replayedRound) return c.json({ error: "Round not found in replay data" }, 404);

  // Build player name map for this round
  const nameMap: Record<string, string> = {};
  for (const p of participants) {
    nameMap[p.player_id] = p.display_name || p.player_id.slice(0, 8);
  }

  // Get pre/post ratings from snapshots
  const ratingChanges = replayedRound.snapshot.map((snap) => ({
    playerId: snap.playerId,
    name: nameMap[snap.playerId] || snap.playerId.slice(0, 8),
    before: Math.round(snap.before),
    after: Math.round(snap.after),
    delta: Math.round(snap.delta),
  }));

  // Get pairwise results
  const pairwiseDetails = replayedRound.pairs.map((pair) => ({
    playerA: nameMap[pair.a] || pair.a.slice(0, 8),
    playerB: nameMap[pair.b] || pair.b.slice(0, 8),
    margin: Math.round(pair.margin * 10) / 10,
    playerAWon: pair.score > 0.5,
    expected: Math.round(pair.expected * 100),
    delta: Math.round(pair.delta * 100) / 100,
  }));

  let narration: string;

  if (isAIEnabled()) {
    // Build AI prompt
    const prompt = buildNarrationPrompt(
      roundRow,
      participants,
      ratingChanges,
      pairwiseDetails
    );
    const aiResponse = await chatCompletion(prompt, {
      maxTokens: 600,
      temperature: 0.7,
    });

    if (aiResponse) {
      narration = aiResponse.trim();
    } else {
      narration = buildRuleBasedNarrative(
        roundRow,
        ratingChanges,
        pairwiseDetails
      );
    }
  } else {
    narration = buildRuleBasedNarrative(
      roundRow,
      ratingChanges,
      pairwiseDetails
    );
  }

  // Store in ai_analysis
  const existing = db
    .prepare("SELECT id FROM ai_analysis WHERE round_id = ?")
    .get(roundId) as any;
  if (existing) {
    db.prepare("UPDATE ai_analysis SET narration = ?, created_at = datetime('now') WHERE round_id = ?")
      .run(narration, roundId);
  } else {
    db.prepare(
      "INSERT INTO ai_analysis (id, round_id, narration) VALUES (?, ?, ?)"
    ).run(uid(), roundId, narration);
  }

  return c.json({ narrative: narration, generatedAt: new Date().toISOString() });
});

function buildNarrationPrompt(
  roundRow: any,
  participants: any[],
  ratingChanges: Array<{ playerId: string; name: string; before: number; after: number; delta: number }>,
  pairwise: Array<{ playerA: string; playerB: string; margin: number; playerAWon: boolean; expected: number; delta: number }>
): string {
  const playerList = participants
    .map((p) => `- ${p.display_name} (handicap: ${p.sga_handicap ?? "N/A"})`)
    .join("\n");

  const ratingLines = ratingChanges
    .map(
      (rc) =>
        `- ${rc.name}: ${rc.before} → ${rc.after} (${rc.delta >= 0 ? "+" : ""}${rc.delta})`
    )
    .join("\n");

  const pairLines = pairwise
    .map(
      (p) =>
        `- ${p.playerA} vs ${p.playerB}: ${p.playerAWon ? p.playerA + " won" : p.playerB + " won"} (margin: ${p.margin.toFixed(1)}, expected win probability: ${p.expected}%)`
    )
    .join("\n");

  return `Write a short, engaging narrative (2-3 sentences) about this golf round for the FORM rating app. Respond entirely in Simplified Chinese (简体中文).

Round details:
- Date: ${roundRow.date}
- Course: ${roundRow.course}
- Format: ${roundRow.format}

Players:
${playerList}

Rating changes:
${ratingLines}

Head-to-head results:
${pairLines}

Describe what happened in plain Chinese. Explain who gained/lost rating points and why (based on expected vs actual performance). Keep it friendly and concise — like a quick recap you'd share in a group chat. Player names stay in their original language (do not translate names).`;
}

function buildRuleBasedNarrative(
  roundRow: any,
  ratingChanges: Array<{ playerId: string; name: string; before: number; after: number; delta: number }>,
  pairwise: Array<{ playerA: string; playerB: string; margin: number; playerAWon: boolean; expected: number; delta: number }>
): string {
  const d = new Date(roundRow.date);
  const date = `${d.getMonth() + 1}月${d.getDate()}日`;

  const parts: string[] = [];

  // Describe each player's result
  for (const rc of ratingChanges) {
    if (rc.delta > 5) {
      parts.push(`${rc.name} 涨了 ${rc.delta} 分（现在 ${rc.after} 分）。`);
    } else if (rc.delta < -5) {
      parts.push(`${rc.name} 掉了 ${Math.abs(rc.delta)} 分（现在 ${rc.after} 分）。`);
    } else {
      parts.push(`${rc.name} 的评分基本没变（现在 ${rc.after} 分）。`);
    }
  }

  // Add context from pairwise results
  for (const p of pairwise) {
    const winner = p.playerAWon ? p.playerA : p.playerB;
    const loser = p.playerAWon ? p.playerB : p.playerA;

    if (p.expected > 60 && p.playerAWon) {
      parts.push(`${winner} 本来就被看好赢 ${loser}，所以评分变动很小。`);
    } else if (p.expected < 40 && p.playerAWon) {
      parts.push(`${winner} 爆冷击败了 ${loser}（赛前胜率只有 ${p.expected}%），引发明显的评分波动。`);
    } else if (p.expected > 60 && !p.playerAWon) {
      parts.push(`${loser} 赛前被看好，却输给了 ${winner}，导致评分大幅变动。`);
    } else {
      parts.push(`${p.playerA} 和 ${p.playerB} 的这场对决非常接近，评分几乎平分秋色。`);
    }
  }

  const prefix = `${roundRow.course}，${date}——`;
  return prefix + parts.join("");
}

// ═══════════════ 3. OCR Scorecard ═══════════════

app.post("/ocr-scorecard", rateLimit(5, 60_000), async (c) => {
  const body = await c.req.parseBody();
  const imageFile = body.image as File | undefined;

  if (!imageFile) return c.json({ error: "No image file provided" }, 400);

  // Validate file type
  const validTypes = ["image/jpeg", "image/png", "image/jpg"];
  if (!validTypes.includes(imageFile.type)) {
    return c.json({ error: "Only JPEG and PNG images are supported" }, 400);
  }

  // Check file size (10MB max)
  const MAX_SIZE = 10 * 1024 * 1024;
  if (imageFile.size > MAX_SIZE) {
    return c.json({ error: "Image must be under 10MB" }, 400);
  }

  if (!isAIEnabled()) {
    return c.json({
      fallback: true,
      message: "Vision AI not configured. Please enter scores manually.",
    });
  }

  // Convert image to base64 data URL for the vision API
  const buffer = await imageFile.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const dataUrl = `data:${imageFile.type};base64,${base64}`;

  const prompt = `Extract golf scorecard data from this image. Return ONLY valid JSON (no markdown, no explanation).

The JSON must have this exact structure:
{
  "players": [
    { "name": "Player Name", "holes": [4,5,3,4,4,3,4,5,4,4,3,4,5,4,3,4,5,4], "total": 72 }
  ],
  "course": "Course Name or null",
  "date": "YYYY-MM-DD or null"
}

Important:
- scores per hole must be an array of numbers (18 holes, or 9 for nine-hole cards)
- If the image doesn't contain a scorecard, return { "players": [], "course": null, "date": null }
- If you can't read a score for a hole, use null for that position
- Parse the date in YYYY-MM-DD format if visible`;

  const aiResponse = await chatCompletion(prompt, {
    maxTokens: 1024,
    temperature: 0.1,
    jsonMode: true,
    imageUrl: dataUrl,
  });

  if (!aiResponse) {
    return c.json({
      fallback: true,
      message: "AI service unavailable. Please enter scores manually.",
    });
  }

  try {
    const result = JSON.parse(aiResponse.trim());
    return c.json(result);
  } catch {
    return c.json({
      fallback: true,
      message: "Could not parse scorecard data. Please enter scores manually.",
    });
  }
});

// ═══════════════ 4. Natural Language Round Parsing ═══════════════

app.post("/parse-round", rateLimit(10, 60_000), async (c) => {
  const body = await c.req.json();
  const schema = z.object({ text: z.string().min(1).max(500) });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400);

  const { text } = parsed.data;

  if (isAIEnabled()) {
    const prompt = `Parse the following golf round description into structured JSON. Return ONLY valid JSON (no markdown, no explanation). The description may be in Chinese or English.

Description: "${text}"

Return this exact structure:
{
  "players": [{ "name": "Player Name", "score": 82 }],
  "course": "Course name or null",
  "format": "stroke" or "stableford" or null,
  "date": "YYYY-MM-DD or null",
  "confidence": "high" or "medium" or "low"
}

Rules:
- Extract player names and scores if present. A score is usually a number 65-120 near a name.
- "打了82杆" means a score of 82. "和小李一起" means 小李 is a player.
- "3只小鸟" means the player had 3 birdies (not a score).
- Common Shanghai courses: Sheshan International (佘山国际), Shanghai Links (林克司), Yintao (银涛), Qizhong (旗忠), Tomson Pudong (汤臣), Lake Malaren (美兰湖), Sun Island (太阳岛), Yingyi Anting (颖奕安亭), Binhai (滨海), Palm Beach (棕榈滩), Tianma (天马), Huakai (华凯), Xintianhong (新天鸿), Dongzhuang Coast (东庄海岸), Lanhai (览海), Shanghai International (上海国际).
- Map partial course names: "佘山"/"sheshan" → "Sheshan International (佘山国际)", "汤臣"/"tomson" → "Tomson Pudong (汤臣)", "美兰湖"/"malaren" → "Lake Malaren Masters (美兰湖·名人赛)", "林克司"/"links" → "Shanghai Links (林克司)".
- Dates: look for YYYY-MM-DD, YYYY年MM月DD日, DD/MM/YYYY, or relative like "昨天", "上周六".
- If "稳定式" or "积分" or "stableford" or "points" is mentioned, set format to "stableford".
- Rate confidence based on how much was clearly extracted vs inferred.
- Return player names in their original language.`;

    const aiResponse = await chatCompletion(prompt, {
      maxTokens: 512,
      temperature: 0.1,
      jsonMode: true,
    });

    if (aiResponse) {
      try {
        const result = JSON.parse(aiResponse.trim());
        return c.json(result);
      } catch {
        // Fall through to regex parser
      }
    }
  }

  // Rule-based regex parser as fallback
  const result = regexParseRound(text);
  return c.json(result);
});

function regexParseRound(text: string) {
  const players: Array<{ name: string; score: number | null }> = [];
  let course: string | null = null;
  let format: "stroke" | "stableford" | null = null;
  let date: string | null = null;
  let confidence: "high" | "medium" | "low" = "low";

  // ── Detect format ──
  if (/stableford/i.test(text) || /\bpts?\b/i.test(text) || /points?\s*$/i.test(text)) {
    format = "stableford";
  } else {
    format = "stroke"; // default to stroke play
  }

  // ── Parse date ──
  // ISO date: YYYY-MM-DD
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    date = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  // DD/MM/YYYY or MM/DD/YYYY
  if (!date) {
    const slashMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (slashMatch) {
      const a = parseInt(slashMatch[1]);
      const b = parseInt(slashMatch[2]);
      const year = slashMatch[3];
      // Heuristic: if first number > 12, it's DD/MM
      if (a > 12) date = `${year}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
      else date = `${year}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
    }
  }
  // Relative dates
  if (!date) {
    const now = new Date();
    const lower = text.toLowerCase();
    if (/\byesterday\b/i.test(text) || /昨天/.test(text)) {
      now.setDate(now.getDate() - 1);
      date = now.toISOString().slice(0, 10);
    } else if (/\btoday\b/i.test(text) || /今天/.test(text)) {
      date = now.toISOString().slice(0, 10);
    } else if (/\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(text)) {
      const dayMap: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
      const m = lower.match(/last\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
      if (m) {
        const targetDay = dayMap[m[1]];
        const currentDay = now.getDay();
        let diff = currentDay - targetDay;
        if (diff <= 0) diff += 7;
        now.setDate(now.getDate() - diff);
        date = now.toISOString().slice(0, 10);
      }
    } else if (/上周(日|天|一|二|三|四|五|六)/.test(text)) {
      const zhDay: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
      const m = text.match(/上周(日|天|一|二|三|四|五|六)/);
      if (m) {
        const targetDay = zhDay[m[1]];
        const currentDay = now.getDay();
        let diff = currentDay - targetDay + 7;
        now.setDate(now.getDate() - diff);
        date = now.toISOString().slice(0, 10);
      }
    } else if (/(\d{4})年(\d{1,2})月(\d{1,2})日/.test(text)) {
      const m = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
      if (m) {
        date = `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
      }
    }
  }

  // ── Extract player name + score pairs ──
  // For stableford, valid scores are 0-54 (points). For stroke, valid scores are 65-150.
  const minScore = format === "stableford" ? 1 : 65;
  const maxScore = format === "stableford" ? 54 : 150;

  // Pattern 1: "Name 82" or "Name: 82" or "Name 36pts" — capitalized word(s) followed by a number
  const nameScorePattern = format === "stableford"
    ? /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*[:\s]+(\d{1,2})\s*(?:pts?|points?)?\b/g
    : /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*[:\s]+(\d{2,3})\b/g;
  let match: RegExpExecArray | null;
  while ((match = nameScorePattern.exec(text)) !== null) {
    const name = match[1].trim();
    const score = parseInt(match[2]);
    if (score >= minScore && score <= maxScore) {
      players.push({ name, score });
    }
  }

  // Pattern 2: "shot/scored/carded/went 82" — keyword + score, no name
  if (players.length === 0) {
    const keywordScorePattern = format === "stableford"
      ? /(?:scored?|got|had|played)\s+(\d{1,2})\s*(?:pts?|points?)?/gi
      : /(?:shot|scored?|carded?|went|played)\s+(\d{2,3})/gi;
    const scores: number[] = [];
    while ((match = keywordScorePattern.exec(text)) !== null) {
      const s = parseInt(match[1]);
      if (s >= minScore && s <= maxScore) scores.push(s);
    }
    // Also try standalone scores: "82, 85, 88" or "36pts, 28pts"
    if (scores.length === 0) {
      const standalonePattern = format === "stableford"
        ? /\b(\d{1,2})\s*(?:pts?|points?)?\s*(?:,|$|\s+at|\s+on)/g
        : /\b(\d{2,3})\s*(?:,|$|\s+at|\s+on|\s+\()/g;
      while ((match = standalonePattern.exec(text)) !== null) {
        const s = parseInt(match[1]);
        if (s >= minScore && s <= maxScore) scores.push(s);
      }
    }
    // Extract names from "with X" or comma-separated capitalized names
    const nameMatches = text.match(/with\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:\s*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)*)/g) || [];
    const names: string[] = [];
    for (const m of nameMatches) {
      const cleaned = m.replace(/^with\s+/, "");
      cleaned.split(/,\s*/).forEach((n) => names.push(n.trim()));
    }
    // Also try "Name and Name played" pattern
    if (names.length === 0) {
      const andPattern = text.match(/([A-Z][a-z]+)\s+and\s+([A-Z][a-z]+)/);
      if (andPattern) {
        names.push(andPattern[1], andPattern[2]);
      }
    }
    if (names.length > 0 && scores.length > 0) {
      names.forEach((name, i) => {
        players.push({ name, score: scores[i] ?? null });
      });
    } else if (scores.length > 0) {
      // Just scores, no names
      players.push({ name: "Player", score: scores[0] });
    } else if (names.length > 0) {
      // Just names, no scores
      names.forEach((name) => players.push({ name, score: null }));
    }
  }

  // ── Confidence rating ──
  if (players.length > 0 && players.every((p) => p.score != null)) {
    confidence = "high";
  } else if (players.length > 0) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  // ── Extract course ──
  const courseMap: Record<string, string> = {
    sheshan: "Sheshan International (佘山国际)",
    佘山: "Sheshan International (佘山国际)",
    links: "Shanghai Links (林克司)",
    林克司: "Shanghai Links (林克司)",
    yintao: "Yintao (银涛)",
    银涛: "Yintao (银涛)",
    qizhong: "Qizhong (旗忠)",
    旗忠: "Qizhong (旗忠)",
    tomson: "Tomson Pudong (汤臣)",
    汤臣: "Tomson Pudong (汤臣)",
    malaren: "Lake Malaren Masters (美兰湖·名人赛)",
    美兰湖: "Lake Malaren Masters (美兰湖·名人赛)",
    "sun island": "Sun Island (太阳岛)",
    太阳岛: "Sun Island (太阳岛)",
    anting: "Yingyi Anting (颖奕安亭)",
    颖奕: "Yingyi Anting (颖奕安亭)",
    安亭: "Yingyi Anting (颖奕安亭)",
    binhai: "Binhai Fairy Lake (滨海·仙湖)",
    滨海: "Binhai Fairy Lake (滨海·仙湖)",
    "palm beach": "Palm Beach (棕榈滩)",
    棕榈滩: "Palm Beach (棕榈滩)",
    tianma: "Tianma (天马)",
    天马: "Tianma (天马)",
    huakai: "Huakai (华凯)",
    华凯: "Huakai (华凯)",
    xintianhong: "Xintianhong (新天鸿名人)",
    新天鸿: "Xintianhong (新天鸿名人)",
    dongzhuang: "Dongzhuang Coast (东庄海岸)",
    东庄: "Dongzhuang Coast (东庄海岸)",
    lanhai: "Lanhai (览海)",
    览海: "Lanhai (览海)",
    "shanghai international": "Shanghai International (上海国际)",
    上海国际: "Shanghai International (上海国际)",
  };

  const lower = text.toLowerCase();
  for (const [key, value] of Object.entries(courseMap)) {
    if (lower.includes(key)) {
      course = value;
      if (confidence === "low") confidence = "medium";
      break;
    }
  }

  return { players, course, format, date, confidence };
}

// ═══════════════ 5. Matchmaking Suggestions ═══════════════

app.post("/match-suggestions", rateLimit(10, 60_000), async (c) => {
  const userId = c.get("userId");

  // Get friends with their info
  const friends = db
    .prepare(
      `SELECT u.id, u.display_name, u.home_club, u.sga_handicap, f.is_regular
       FROM friendships f JOIN users u ON f.friend_id = u.id
       WHERE f.user_id = ?`
    )
    .all(userId) as any[];

  if (friends.length === 0) {
    return c.json({ suggestions: [] });
  }

  // Get replay result for current ratings
  const { players, rounds } = buildReplayData(userId);
  const result = replay(players, rounds, DEFAULTS);

  // Get user's current rating
  const userPlayer = result.players.find((p) => p.id === userId);
  const userRating = userPlayer?.rating ?? seedRating(undefined, DEFAULTS);

  // Get user's home course
  const userRow = db
    .prepare("SELECT home_club FROM users WHERE id = ?")
    .get(userId) as any;
  const userHomeClub = userRow?.home_club || "";

  // Find recent opponents (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);

  const recentOpponents = new Set<string>();
  const lastPlayedMap: Record<string, string> = {};

  for (const r of rounds) {
    if (r.date < cutoff) continue;
    const participants = db
      .prepare("SELECT player_id FROM round_participants WHERE round_id = ?")
      .all(r.id) as any[];
    const hasUser = participants.some((p: any) => p.player_id === userId);
    if (!hasUser) continue;

    for (const p of participants) {
      if (p.player_id !== userId) {
        recentOpponents.add(p.player_id);
        if (!lastPlayedMap[p.player_id] || r.date > lastPlayedMap[p.player_id]) {
          lastPlayedMap[p.player_id] = r.date;
        }
      }
    }
  }

  // Find all-time last played dates for friends not in the 30-day window
  for (const r of rounds) {
    const participants = db
      .prepare("SELECT player_id FROM round_participants WHERE round_id = ?")
      .all(r.id) as any[];
    const hasUser = participants.some((p: any) => p.player_id === userId);
    if (!hasUser) continue;

    for (const p of participants) {
      if (
        p.player_id !== userId &&
        !lastPlayedMap[p.player_id] &&
        friends.some((f: any) => f.id === p.player_id)
      ) {
        if (!lastPlayedMap[p.player_id] || r.date > lastPlayedMap[p.player_id]) {
          lastPlayedMap[p.player_id] = r.date;
        }
      }
    }
  }

  // Score each friend
  const today = new Date();
  const scored = friends.map((f: any) => {
    let score = 0;
    const reasons: string[] = [];

    const friendRating = result.players.find((p) => p.id === f.id)?.rating ?? seedRating(f.sga_handicap, DEFAULTS);
    const ratingGap = Math.abs(friendRating - userRating);

    // Factor 1: Days since last played (boost for not recently played)
    const lastPlayed = lastPlayedMap[f.id];
    const daysSinceLast = lastPlayed
      ? Math.floor((today.getTime() - new Date(lastPlayed).getTime()) / 86400000)
      : 999; // Never played — huge boost

    if (daysSinceLast > 21) {
      score += 30;
      reasons.push(`Haven't played ${f.display_name} in ${daysSinceLast} days.`);
    } else if (daysSinceLast > 7) {
      score += 15;
      reasons.push(`Last played ${f.display_name} ${daysSinceLast} days ago.`);
    } else if (daysSinceLast === 999) {
      score += 25;
      reasons.push(`You've never played ${f.display_name}.`);
    } else if (!recentOpponents.has(f.id)) {
      score += 10;
      reasons.push(`Last played ${f.display_name} recently.`);
    } else {
      reasons.push(`Last played ${f.display_name} ${daysSinceLast} days ago.`);
    }

    // Factor 2: Rating proximity (boost for close ratings)
    if (ratingGap < 30) {
      score += 25;
      reasons.push(`Your ratings are within ${ratingGap.toFixed(1)} points — a close match.`);
    } else if (ratingGap < 80) {
      score += 15;
      reasons.push(`Rating gap of ${ratingGap.toFixed(1)} points — a competitive round.`);
    } else {
      score += 5;
      reasons.push(`Rating gap of ${ratingGap.toFixed(1)} points — a tough test.`);
    }

    // Factor 3: Regular flag boost
    if (f.is_regular) {
      score += 15;
      reasons.push(`${f.display_name} is a regular playing partner.`);
    }

    // Factor 4: Different course variety
    if (f.home_club && f.home_club !== userHomeClub) {
      score += 5;
    }

    return {
      playerId: f.id,
      playerName: f.display_name,
      rating: Math.round(friendRating),
      reason: reasons.join(" "),
      daysSinceLastPlayed: daysSinceLast === 999 ? null : daysSinceLast,
      ratingGap,
      score,
    };
  });

  // Sort by score descending, take top 5
  scored.sort((a, b) => b.score - a.score);
  const suggestions = scored.slice(0, 5).map(({ score, ...rest }) => rest);

  // Optionally enhance top suggestion with AI
  if (isAIEnabled() && suggestions.length > 0) {
    const top = suggestions[0];
    const prompt = `Write a friendly, one-sentence suggestion for a golf match between the user and ${
      top.playerName
    }. Respond in Simplified Chinese. Context: ratings are ${Math.round(userRating)} (user) vs ${
      top.rating
    } (${top.playerName}), ${
      top.daysSinceLastPlayed
        ? `last played ${top.daysSinceLastPlayed} days ago`
        : "never played before"
    }. Just return the suggestion text in Chinese, no quotes or extra text.`;

    const aiText = await chatCompletion(prompt, { maxTokens: 100, temperature: 0.8 });
    if (aiText) {
      suggestions[0].reason = aiText.trim();
    }
  }

  return c.json({ suggestions });
});

// ═══════════════ 6. Anomaly Detection ═══════════════

export interface DetectedAnomalyRecord extends DetectedAnomaly {
  playerId: string;
  playerName: string;
}

/**
 * Runs self-relative statistical anomaly detection (see engine/anomaly.ts)
 * for one user's own confirmed rounds and persists any newly-detected flags
 * into ai_analysis. Called both from the on-demand /detect-anomalies route
 * and automatically whenever a round involving this user is confirmed, so
 * flags exist without anyone needing to trigger detection by hand.
 */
export function runAnomalyDetectionForUser(userId: string): DetectedAnomalyRecord[] {
  // Get all confirmed rounds involving the user
  const roundRows = db
    .prepare(
      `SELECT DISTINCT r.* FROM rounds r
       JOIN round_participants rp ON r.id = rp.round_id
       WHERE r.status = 'confirmed' AND rp.player_id = ?
       ORDER BY r.date ASC`
    )
    .all(userId) as any[];

  if (roundRows.length < 3) return [];

  // Build participant data
  const allParts: any[] = [];
  for (const r of roundRows) {
    const parts = db
      .prepare("SELECT * FROM round_participants WHERE round_id = ? AND player_id = ?")
      .all(r.id, userId) as any[];
    for (const p of parts) {
      allParts.push({ ...p, roundId: r.id, date: r.date, course: r.course, format: r.format });
    }
  }

  // Get replay for rating deltas
  const { players, rounds } = buildReplayData(userId);
  const result = replay(players, rounds, DEFAULTS);
  const userName = getPlayerName(userId);

  const strokeRounds = allParts
    .filter((p: any) => p.format === "stroke" && p.ags != null)
    .map((p: any) => ({ roundId: p.roundId, ags: p.ags, date: p.date, course: p.course }));

  const ratingDeltas = result.rounds
    .map((rr) => {
      const snap = rr.snapshot.find((s) => s.playerId === userId);
      return snap ? { roundId: rr.id, delta: snap.delta, date: rr.date, course: rr.course } : null;
    })
    .filter((d): d is { roundId: string; delta: number; date: string; course: string } => d != null);

  const anomalies = detectAnomalies(userName, strokeRounds, ratingDeltas);

  for (const a of anomalies) {
    const existing = db.prepare("SELECT id FROM ai_analysis WHERE round_id = ?").get(a.roundId) as any;
    if (existing) {
      db.prepare(
        "UPDATE ai_analysis SET flagged = 1, flag_reason = ? WHERE round_id = ?"
      ).run(a.reason, a.roundId);
    } else {
      db.prepare(
        "INSERT INTO ai_analysis (id, round_id, flagged, flag_reason) VALUES (?, ?, 1, ?)"
      ).run(uid(), a.roundId, a.reason);
    }
  }

  return anomalies.map((a) => ({ ...a, playerId: userId, playerName: userName }));
}

app.post("/detect-anomalies", rateLimit(5, 60_000), async (c) => {
  const userId = c.get("userId");
  const anomalies = runAnomalyDetectionForUser(userId);
  return c.json({ anomalies });
});

// ═══════════════ 7. Season Recap ═══════════════

app.get("/season-recap/:playerId", rateLimit(10, 60_000), async (c) => {
  const userId = c.get("userId");
  let targetId = c.req.param("playerId");

  // "me" is an alias for the authenticated user
  if (targetId === "me") {
    targetId = userId;
  }

  // Only allow viewing self or friends
  if (targetId !== userId) {
    const isFriend = db
      .prepare(
        "SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?"
      )
      .get(userId, targetId);
    if (!isFriend) {
      return c.json({ error: "Not authorized" }, 403);
    }
  }

  // Get player info
  const player = db
    .prepare(
      "SELECT id, display_name, home_club, sga_handicap FROM users WHERE id = ?"
    )
    .get(targetId) as any;
  if (!player) return c.json({ error: "Player not found" }, 404);

  const playerName = player.display_name || targetId.slice(0, 8);

  // Get all confirmed rounds involving this player
  const roundRows = db
    .prepare(
      `SELECT DISTINCT r.* FROM rounds r
       JOIN round_participants rp ON r.id = rp.round_id
       WHERE r.status = 'confirmed' AND rp.player_id = ?
       ORDER BY r.date ASC`
    )
    .all(targetId) as any[];

  if (roundRows.length === 0) {
    return c.json({
      stats: { totalRounds: 0 },
      narrative: `${playerName} 本赛季还没有已确认的球局。`,
      period: { from: null, to: null },
    });
  }

  // Get replay data for rating/handicap trends
  const { players, rounds } = buildReplayData(userId);

  // Ensure target player is in the player list
  const playerIds = players.map((p) => p.id);
  if (!playerIds.includes(targetId)) {
    players.push({
      id: targetId,
      name: playerName,
      club: player.home_club || "",
      seed: player.sga_handicap ?? undefined,
    });
  }

  const result = replay(players, rounds, DEFAULTS);
  const playerState = result.players.find((p) => p.id === targetId);

  // Gather stats
  const totalRounds = roundRows.length;
  const formatCounts: Record<string, number> = {};
  const courseCounts: Record<string, number> = {};
  let bestScore = Infinity;
  let bestScoreDate = "";
  let worstScore = -Infinity;
  let worstScoreDate = "";
  const winLoss: Record<string, { wins: number; losses: number }> = {};
  const ratings: Array<{ date: string; rating: number }> = [];

  for (const rr of result.rounds) {
    // Check if this round involves the target
    const snap = rr.snapshot.find((s) => s.playerId === targetId);
    if (!snap) continue;

    ratings.push({ date: rr.date, rating: Math.round(snap.after) });

    // Count formats
    formatCounts[rr.format] = (formatCounts[rr.format] || 0) + 1;

    // Count courses
    courseCounts[rr.course] = (courseCounts[rr.course] || 0) + 1;

    // Track scores
    const part = db
      .prepare(
        "SELECT ags FROM round_participants WHERE round_id = ? AND player_id = ?"
      )
      .get(rr.id, targetId) as any;
    if (part?.ags != null) {
      if (part.ags < bestScore) {
        bestScore = part.ags;
        bestScoreDate = rr.date;
      }
      if (part.ags > worstScore) {
        worstScore = part.ags;
        worstScoreDate = rr.date;
      }
    }

    // Win/loss against opponents
    for (const pair of rr.pairs) {
      const isA = pair.a === targetId;
      const isB = pair.b === targetId;
      if (!isA && !isB) continue;

      const opponentId = isA ? pair.b : pair.a;
      if (!winLoss[opponentId]) {
        winLoss[opponentId] = { wins: 0, losses: 0 };
      }

      const iWon = isA ? pair.score > 0.5 : pair.score < 0.5;
      if (iWon) {
        winLoss[opponentId].wins++;
      } else {
        winLoss[opponentId].losses++;
      }
    }
  }

  // Build win/loss records with names
  const headToHead: Array<{
    opponentName: string;
    wins: number;
    losses: number;
  }> = [];
  for (const [oppId, record] of Object.entries(winLoss)) {
    headToHead.push({
      opponentName: getPlayerName(oppId),
      wins: record.wins,
      losses: record.losses,
    });
  }
  headToHead.sort((a, b) => b.wins + b.losses - (a.wins + a.losses));

  // Most played course
  let mostPlayedCourse = "";
  let mostPlayedCount = 0;
  for (const [course, count] of Object.entries(courseCounts)) {
    if (count > mostPlayedCount) {
      mostPlayedCourse = course;
      mostPlayedCount = count;
    }
  }

  // Peak and low ratings
  let peakRating = 0;
  let peakDate = "";
  let lowRating = Infinity;
  let lowDate = "";
  for (const r of ratings) {
    if (r.rating > peakRating) {
      peakRating = r.rating;
      peakDate = r.date;
    }
    if (r.rating < lowRating) {
      lowRating = r.rating;
      lowDate = r.date;
    }
  }

  // Rating trend (last 5 rounds)
  const trend = ratings.slice(-5).map((r) => r.rating);

  // Handicap trend
  const hcpTrend =
    playerState?.differentials?.length
      ? playerState.differentials.slice(-5)
      : [];

  const stats = {
    totalRounds,
    peakRating: ratings.length ? peakRating : null,
    peakDate: peakDate || null,
    lowRating: ratings.length && lowRating !== Infinity ? lowRating : null,
    lowDate: lowDate || null,
    bestScore: bestScore !== Infinity ? bestScore : null,
    bestScoreDate: bestScoreDate || null,
    worstScore: worstScore !== -Infinity ? worstScore : null,
    worstScoreDate: worstScoreDate || null,
    mostPlayedCourse: mostPlayedCourse || null,
    mostPlayedCourseRounds: mostPlayedCount || 0,
    headToHead,
    ratingTrend: trend,
    handicapTrend: hcpTrend,
    handicapIndex: playerState?.hcpIndex ?? null,
    formats: formatCounts,
    courseCounts,
  };

  // Generate narrative
  let narrative: string;

  if (isAIEnabled()) {
    const prompt = buildRecapPrompt(playerName, stats);
    const aiResponse = await chatCompletion(prompt, {
      maxTokens: 800,
      temperature: 0.7,
    });

    narrative =
      trimTrailingFragment(aiResponse || "") ||
      buildRuleBasedRecap(playerName, stats);
  } else {
    narrative = buildRuleBasedRecap(playerName, stats);
  }

  return c.json({
    stats,
    narrative,
    period: {
      from: roundRows[0]?.date || null,
      to: roundRows[roundRows.length - 1]?.date || null,
    },
  });
});

function buildRecapPrompt(
  playerName: string,
  stats: Record<string, unknown>
): string {
  return `Write a season recap for ${playerName}'s golf season using the FORM rating system. Write the recap body entirely in Simplified Chinese (简体中文). Keep the section labels EXACTLY as written below in English.

Stats:
- Total rounds: ${stats.totalRounds}
- Peak rating: ${stats.peakRating} (on ${stats.peakDate})
- Low rating: ${stats.lowRating} (on ${stats.lowDate})
- Best round: ${stats.bestScore} at ${stats.bestScoreDate}
- Worst round: ${stats.worstScore} at ${stats.worstScoreDate}
- Most played: ${stats.mostPlayedCourse} (${stats.mostPlayedCourseRounds} rounds)
- Handicap index: ${stats.handicapIndex ?? "N/A"}
- Rating trend (last 5): ${(stats.ratingTrend as number[])?.join(" → ") || "N/A"}

Head-to-head records:
${(stats.headToHead as Array<{ opponentName: string; wins: number; losses: number }>)
  ?.map((h) => `  ${h.opponentName}: ${h.wins}W-${h.losses}L`)
  .join("\n") || "None"}

Structure the recap into exactly these sections, each with 2-4 bullet points:

Form: Brief summary of how the season went — peaks, lows, and overall trajectory.
Results: Highlight best/worst rounds, most played course, and key numbers.
Matchups: Break down head-to-head records and notable rivalries.
Outlook: Forward-looking takeaway or advice for next season.
Bottom line: One sharp closing thought.

Use the exact English section labels above followed by a colon. Write each bullet in Simplified Chinese, one sentence per bullet. Be friendly and concise, like a golf buddy recap. Player and course names stay in their original language.`;
}

function buildRuleBasedRecap(
  playerName: string,
  stats: Record<string, unknown>
): string {
  const totalRounds = stats.totalRounds as number;
  if (totalRounds === 0) return `${playerName} 本赛季还没有已确认的球局。`;

  const formBullets: string[] = [
    `${playerName} 本赛季共打了 ${totalRounds} 场球。`,
  ];

  const trend = stats.ratingTrend as number[];
  if (trend && trend.length >= 2) {
    const first = trend[0];
    const last = trend[trend.length - 1];
    if (last > first + 10) {
      formBullets.push("评分一路上扬，状态火热。");
    } else if (last < first - 10) {
      formBullets.push("近期评分有所回落，是时候打一场翻身仗了。");
    } else {
      formBullets.push("评分整体保持平稳。");
    }
  }

  const resultsBullets: string[] = [];
  if (stats.peakRating && stats.peakDate) {
    resultsBullets.push(`赛季最高评分 ${stats.peakRating} 分，出现在 ${stats.peakDate}。`);
  }
  if (stats.bestScore && stats.bestScoreDate) {
    resultsBullets.push(`最佳单轮成绩为 ${stats.bestScore} 杆，出自 ${stats.bestScoreDate}。`);
  }
  if (stats.mostPlayedCourse && stats.mostPlayedCourseRounds) {
    resultsBullets.push(`最常打的球场是 ${stats.mostPlayedCourse}（共 ${stats.mostPlayedCourseRounds} 场）。`);
  }
  if (stats.handicapIndex != null) {
    resultsBullets.push(`当前差点指数：${stats.handicapIndex}。`);
  }

  const matchupBullets: string[] = [];
  const h2h = stats.headToHead as Array<{
    opponentName: string;
    wins: number;
    losses: number;
  }>;
  if (h2h && h2h.length > 0) {
    const bestRecord = h2h.reduce((best, cur) =>
      cur.wins - cur.losses > best.wins - best.losses ? cur : best
    );
    if (bestRecord.wins > bestRecord.losses) {
      matchupBullets.push(`对阵 ${bestRecord.opponentName} 的战绩最佳（${bestRecord.wins}胜${bestRecord.losses}负）。`);
    } else {
      matchupBullets.push(`与 ${bestRecord.opponentName} 的对决打得最胶着（${bestRecord.wins}胜${bestRecord.losses}负）。`);
    }
  }

  const outlookBullets: string[] = ["继续保持稳定的训练和参赛节奏，评分自然会水涨船高。"];

  const sections: string[] = [];
  if (formBullets.length) sections.push(`状态：${formBullets.join("")}`);
  if (resultsBullets.length) sections.push(`成绩：${resultsBullets.join("")}`);
  if (matchupBullets.length) sections.push(`对战：${matchupBullets.join("")}`);
  sections.push(`展望：${outlookBullets.join("")}`);
  sections.push(`总结：${playerName}，保持热爱，下一场更精彩。`);

  return sections.join("\n");
}

// ═══════════════ 8. Refresh Pro Player Data ═══════════════
// Admin-only endpoint that uses AI to reassess professional golfer ratings.
// When AI is configured, it asks the LLM to evaluate each pro's current form
// and suggest an updated plus-handicap. When AI is not available, it applies
// a deterministic rule-based adjustment based on stored data.

// Exported handler — used by both the auth-protected and admin-panel routes
export async function refreshProHandicaps() {
  // Ensure the canonical famous-player roster exists with is_pro=1. On older
  // databases some pros may be missing entirely or lack the pro flag.
  const admin = db.prepare("SELECT id FROM users WHERE is_admin = 1 LIMIT 1").get() as
    | { id: string }
    | undefined;
  const anyUser = db.prepare("SELECT id FROM users LIMIT 1").get() as
    | { id: string }
    | undefined;
  await ensureFamousPlayers(db, admin?.id ?? anyUser?.id ?? null);

  const pros = db
    .prepare(
      "SELECT id, display_name, home_club, region, sga_handicap FROM users WHERE is_pro = 1"
    )
    .all() as Array<{
      id: string;
      display_name: string;
      home_club: string | null;
      region: string | null;
      sga_handicap: number | null;
    }>;

  if (pros.length === 0) {
    return { updated: 0, message: "No pro players found in database." };
  }

  const updates: Array<{
    name: string;
    oldHcp: number | null;
    newHcp: number;
    reason: string;
  }> = [];

  if (isAIEnabled()) {
    const proList = pros
      .map(
        (p) =>
          `- ${p.display_name} (region: ${p.region || "unknown"}, current plus-handicap: ${p.sga_handicap != null ? -p.sga_handicap : "N/A"})`
      )
      .join("\n");

    const prompt = `You are a golf analytics expert. Assess the current form of these professional golfers and suggest updated plus-handicaps for an ELO rating system.

Golfers:
${proList}

For each golfer, consider:
- Recent tournament performance and world ranking
- Major championship results
- Current form (improving, declining, steady)
- Injury status if known

Return ONLY valid JSON (no markdown, no explanation) with this structure:
{
  "players": [
    { "name": "Tiger Woods", "plusHandicap": 7.5, "reason": "Brief one-sentence reason" }
  ]
}

Rules:
- Plus handicap is a positive number (e.g., 7.5 means +7.5, which is WHS -7.5)
- Elite tour pros typically range from +5 to +9
- All-time greats at peak: +8 to +10
- Be conservative — don't change by more than 1.5 from the current value unless justified`;

    const aiResponse = await chatCompletion(prompt, {
      maxTokens: 1024,
      temperature: 0.3,
      jsonMode: true,
    });

    if (aiResponse) {
      try {
        const result = JSON.parse(aiResponse.trim());
        const playerUpdates: Array<{
          name: string;
          plusHandicap: number;
          reason: string;
        }> = result.players || [];

        for (const pu of playerUpdates) {
          const pro = pros.find(
            (p) => p.display_name.toLowerCase() === pu.name.toLowerCase()
          );
          if (pro && typeof pu.plusHandicap === "number") {
            const clampedPlus = Math.max(3, Math.min(10, pu.plusHandicap));
            const newWhsHcp = -clampedPlus;

            db.prepare("UPDATE users SET sga_handicap = ?, updated_at = datetime('now') WHERE id = ?")
              .run(newWhsHcp, pro.id);

            updates.push({
              name: pro.display_name,
              oldHcp: pro.sga_handicap,
              newHcp: newWhsHcp,
              reason: pu.reason || "AI-adjusted based on current form",
            });
          }
        }
      } catch {
        // JSON parse failed — fall through to rule-based
      }
    }
  }

  // Rule-based fallback
  if (updates.length === 0) {
    for (const pro of pros) {
      const currentPlus = pro.sga_handicap != null ? -pro.sga_handicap : 6.0;
      const hash = pro.display_name.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      const adjustment = ((hash % 7) - 3) * 0.1;
      const newPlus = Math.max(3, Math.min(10, currentPlus + adjustment));
      const newWhsHcp = -Math.round(newPlus * 10) / 10;

      if (pro.sga_handicap !== newWhsHcp) {
        db.prepare("UPDATE users SET sga_handicap = ?, updated_at = datetime('now') WHERE id = ?")
          .run(newWhsHcp, pro.id);

        updates.push({
          name: pro.display_name,
          oldHcp: pro.sga_handicap,
          newHcp: newWhsHcp,
          reason: "Rule-based form adjustment",
        });
      }
    }
  }

  // Store last refresh timestamp
  const existing = db.prepare("SELECT key FROM config WHERE key = 'last_pro_refresh'").get();
  if (existing) {
    db.prepare("UPDATE config SET value = ? WHERE key = 'last_pro_refresh'").run(
      new Date().toISOString()
    );
  } else {
    db.prepare("INSERT INTO config (key, value) VALUES (?, ?)").run(
      "last_pro_refresh",
      new Date().toISOString()
    );
  }

  return {
    updated: updates.length,
    updates,
    refreshedAt: new Date().toISOString(),
  };
}

app.post("/refresh-pros", adminMiddleware, async (c) => {
  const result = await refreshProHandicaps();
  return c.json(result);
});

export default app;
