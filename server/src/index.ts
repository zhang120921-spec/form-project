import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { hash, verify } from "argon2";
import crypto from "crypto";
import db from "./db/connection.js";
import { runMigrations } from "./db/schema.js";
import { authMiddleware, adminMiddleware, createToken, hashToken, type AppEnv } from "./middleware/auth.js";
import { rateLimit } from "./middleware/rateLimit.js";
import adminRoutes from "./admin/routes.js";
import aiRoutes, { refreshProHandicaps, runAnomalyDetectionForUser } from "./ai/routes.js";
import { getAIConfig } from "./ai/service.js";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = new Hono<AppEnv>();
const PORT = parseInt(process.env.PORT || "3001");

// CORS — allow dev server origins + null (for standalone file:// builds)
app.use("*", cors({ origin: ["http://localhost:5173", "http://localhost:4173", "http://localhost:3000", "null"], credentials: true }));

// Run migrations on startup
runMigrations();

const uid = () => crypto.randomUUID();

// ═══════════════ AUTH ═══════════════

app.post("/api/auth/register", async (c) => {
  const body = await c.req.json();
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    displayName: z.string().min(1).max(100),
    homeClub: z.string().max(100).optional(),
    sgaHandicap: z.number().min(-10).max(54).optional(),
    // PIPL (China Personal Information Protection Law) — explicit consent required
    consent: z.literal(true, { errorMap: () => ({ message: "You must agree to the privacy policy to create an account" }) }),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400);

  const { email, password, displayName, homeClub, sgaHandicap } = parsed.data;

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return c.json({ error: "Email already registered" }, 409);

  const id = uid();
  const passwordHash = await hash(password);
  db.prepare(`INSERT INTO users (id, email, password_hash, display_name, home_club, sga_handicap)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, email, passwordHash, displayName, homeClub || null, sgaHandicap ?? null);

  const token = await createToken(id);
  return c.json({
    user: {
      id, email, displayName,
      homeClub: homeClub || null,
      sgaHandicap: sgaHandicap ?? null,
      isPublic: false,
    },
    token,
  });
});

app.post("/api/auth/login", rateLimit(10, 60_000), async (c) => {
  const body = await c.req.json();
  const { email, password } = body;
  if (!email || !password) return c.json({ error: "Email and password required" }, 400);

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
  if (!user) return c.json({ error: "Invalid email or password" }, 401);

  const valid = await verify(user.password_hash, password);
  if (!valid) return c.json({ error: "Invalid email or password" }, 401);

  if (user.is_suspended) return c.json({ error: "Account suspended" }, 403);

  const token = await createToken(user.id);
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      homeClub: user.home_club,
      region: user.region,
      sgaHandicap: user.sga_handicap,
      isPublic: !!user.is_public,
      isAdmin: !!user.is_admin,
      createdAt: user.created_at,
    },
    token,
  });
});

app.get("/api/auth/session", authMiddleware, (c) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(c.get("userId")) as any;
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json({
    id: user.id, email: user.email, displayName: user.display_name,
    homeClub: user.home_club, region: user.region,
    sgaHandicap: user.sga_handicap, isPublic: !!user.is_public, createdAt: user.created_at,
  });
});

// Change password — authenticated, verifies current password with argon2
app.post("/api/auth/change-password", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(6),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400);

  const { currentPassword, newPassword } = parsed.data;

  const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as any;
  if (!user) return c.json({ error: "User not found" }, 404);

  const valid = await verify(user.password_hash, currentPassword);
  if (!valid) return c.json({ error: "Current password is incorrect" }, 401);

  const newHash = await hash(newPassword);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(newHash, userId);

  return c.json({ success: true });
});

// Forgot password — request a reset token (public, doesn't leak user existence)
app.post("/api/auth/forgot-password", async (c) => {
  const body = await c.req.json();
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400);

  const { email } = parsed.data;

  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as any;
  // Always return success to avoid leaking user existence
  if (!user) return c.json({ success: true, message: "If that email is registered, a reset token has been generated." });

  const token = crypto.randomUUID();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h from now

  db.prepare("INSERT INTO password_resets (id, user_id, token_hash, token_plain, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(uid(), user.id, tokenHash, token, expiresAt);

  // Never return the token in the response. There is no email/notification
  // system in the localhost trial, so admins retrieve pending tokens via
  // GET /api/admin/password-resets and share them with students out-of-band.
  return c.json({ success: true, message: "If that email is registered, a reset token has been generated." });
});

// Admin — list active password reset tokens (trial fallback for the missing email system).
// Only visible to admins; used to hand a reset token to a student who forgot their password.
app.get("/api/admin/password-resets", authMiddleware, adminMiddleware, (c) => {
  const rows = db
    .prepare(
      `SELECT pr.id, pr.user_id, u.email, u.display_name, pr.token_plain, pr.expires_at, pr.used
       FROM password_resets pr JOIN users u ON pr.user_id = u.id
       WHERE pr.used = 0 AND pr.expires_at > datetime('now')
       ORDER BY pr.created_at DESC`
    )
    .all() as any[];
  return c.json({
    resets: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      email: r.email,
      displayName: r.display_name,
      token: r.token_plain,
      expiresAt: r.expires_at,
    })),
  });
});

// Reset password — validate token and update password (public)
app.post("/api/auth/reset-password", async (c) => {
  const body = await c.req.json();
  const schema = z.object({
    token: z.string().min(1),
    newPassword: z.string().min(6),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400);

  const { token, newPassword } = parsed.data;
  const tokenHash = hashToken(token);

  const reset = db.prepare(
    "SELECT * FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')"
  ).get(tokenHash) as any;

  if (!reset) return c.json({ error: "Invalid or expired reset token" }, 400);

  const newHash = await hash(newPassword);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(newHash, reset.user_id);
  db.prepare("UPDATE password_resets SET used = 1 WHERE id = ?").run(reset.id);

  return c.json({ success: true });
});

// ═══════════════ PROFILE ═══════════════

app.get("/api/profile", authMiddleware, (c) => {
  const userId = c.get("userId");
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
  if (!user) return c.json({ error: "Not found" }, 404);

  // Derive rating from the replay engine (single source of truth)
  const { players, rounds } = buildReplayData(userId);
  const result = replay(players, rounds, DEFAULTS);
  const state = result.players.find((p) => p.id === userId);

  // Rank is scope-relative (not a PlayerState field) — rank within the
  // user's own friends network, same scope /api/rankings defaults to.
  const sortedByRating = result.players
    .filter((p) => p.rating != null)
    .sort((a, b) => b.rating - a.rating);
  const rankIndex = sortedByRating.findIndex((p) => p.id === userId);
  const rank = rankIndex >= 0 ? rankIndex + 1 : null;

  return c.json({
    id: user.id, email: user.email, displayName: user.display_name,
    homeClub: user.home_club, region: user.region,
    sgaHandicap: user.sga_handicap, isPublic: !!user.is_public, createdAt: user.created_at,
    rating: state?.rating ?? null,
    ratingDeviation: state?.rd ?? null,
    rank,
    matches: state?.matches ?? 0,
    isProvisional: state?.isProvisional ?? true,
  });
});

app.patch("/api/profile", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const schema = z.object({
    displayName: z.string().min(1).max(100).optional(),
    homeClub: z.string().max(100).optional(),
    region: z.string().max(100).optional(),
    sgaHandicap: z.number().min(-10).max(54).optional(),
    isPublic: z.boolean().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400);

  const { displayName, homeClub, region, sgaHandicap, isPublic } = parsed.data;
  const updates: string[] = [];
  const values: any[] = [];

  if (displayName !== undefined) { updates.push("display_name = ?"); values.push(displayName); }
  if (homeClub !== undefined) { updates.push("home_club = ?"); values.push(homeClub); }
  if (region !== undefined) { updates.push("region = ?"); values.push(region); }
  if (sgaHandicap !== undefined) { updates.push("sga_handicap = ?"); values.push(sgaHandicap); }
  if (isPublic !== undefined) { updates.push("is_public = ?"); values.push(isPublic ? 1 : 0); }

  if (updates.length === 0) return c.json({ error: "No valid fields" }, 400);

  updates.push("updated_at = datetime('now')");
  values.push(userId);
  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
  return c.json({
    id: user.id, email: user.email, displayName: user.display_name,
    homeClub: user.home_club, region: user.region,
    sgaHandicap: user.sga_handicap, isPublic: !!user.is_public, createdAt: user.created_at,
  });
});

// Delete account — authenticated, cascades all user data
app.delete("/api/auth/account", authMiddleware, (c) => {
  const userId = c.get("userId");

  // Delete all related data in dependency order
  db.prepare("DELETE FROM friendships WHERE user_id = ? OR friend_id = ?").run(userId, userId);
  db.prepare("DELETE FROM friend_requests WHERE from_id = ? OR to_id = ?").run(userId, userId);
  db.prepare("DELETE FROM attestations WHERE from_id = ? OR to_id = ?").run(userId, userId);
  db.prepare("DELETE FROM round_participants WHERE player_id = ?").run(userId);
  db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);

  return c.json({ success: true });
});

// ═══════════════ FRIENDS ═══════════════

app.get("/api/friends", authMiddleware, (c) => {
  const userId = c.get("userId");
  const friends = db.prepare(`
    SELECT u.id, u.display_name, u.home_club, f.is_regular FROM friendships f
    JOIN users u ON f.friend_id = u.id WHERE f.user_id = ?
  `).all(userId);
  return c.json(friends);
});

app.get("/api/friends/requests", authMiddleware, (c) => {
  const userId = c.get("userId");
  const sent = db.prepare("SELECT fr.id, fr.from_id, fr.to_id, fr.status, fr.message, fr.created_at, u.display_name FROM friend_requests fr JOIN users u ON fr.to_id = u.id WHERE fr.from_id = ? AND fr.status = 'pending'").all(userId);
  const received = db.prepare("SELECT fr.id, fr.from_id, fr.to_id, fr.status, fr.message, fr.created_at, u.display_name FROM friend_requests fr JOIN users u ON fr.from_id = u.id WHERE fr.to_id = ? AND fr.status = 'pending'").all(userId);
  return c.json({ sent, received });
});

app.post("/api/friends/request", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const { toId, message } = body as any;
  if (!toId) return c.json({ error: "Missing recipient" }, 400);
  if (toId === userId) return c.json({ error: "You can't add yourself as a friend" }, 400);

  // Sanitise message
  const msg = typeof message === "string" ? message.slice(0, 200).trim() : "";

  const existing = db.prepare("SELECT id FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'").get(userId, toId);
  if (existing) return c.json({ error: "Request already sent" }, 409);

  const already = db.prepare("SELECT id FROM friendships WHERE user_id = ? AND friend_id = ?").get(userId, toId);
  if (already) return c.json({ error: "Already friends" }, 409);

  const id = uid();
  db.prepare("INSERT INTO friend_requests (id, from_id, to_id, message) VALUES (?, ?, ?, ?)").run(id, userId, toId, msg);
  return c.json({ id, fromId: userId, toId, status: "pending", message: msg }, 201);
});

app.post("/api/friends/accept/:id", authMiddleware, (c) => {
  const userId = c.get("userId");
  const requestId = c.req.param("id");
  const fr = db.prepare("SELECT * FROM friend_requests WHERE id = ? AND to_id = ? AND status = 'pending'").get(requestId, userId) as any;
  if (!fr) return c.json({ error: "Request not found" }, 404);

  const doAccept = db.transaction(() => {
    db.prepare("UPDATE friend_requests SET status = 'accepted', updated_at = datetime('now') WHERE id = ?").run(requestId);
    const fId = uid();
    db.prepare("INSERT INTO friendships (id, user_id, friend_id) VALUES (?, ?, ?)").run(fId, fr.from_id, userId);
    const fId2 = uid();
    db.prepare("INSERT INTO friendships (id, user_id, friend_id) VALUES (?, ?, ?)").run(fId2, userId, fr.from_id);
  });
  doAccept();
  return c.json({ success: true });
});

app.post("/api/friends/decline/:id", authMiddleware, (c) => {
  const userId = c.get("userId");
  const requestId = c.req.param("id");
  db.prepare("UPDATE friend_requests SET status = 'declined', updated_at = datetime('now') WHERE id = ? AND to_id = ?").run(requestId, userId);
  return c.json({ success: true });
});

app.post("/api/friends/remove/:id", authMiddleware, (c) => {
  const userId = c.get("userId");
  const friendId = c.req.param("id");
  db.prepare("DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)").run(userId, friendId, friendId, userId);
  db.prepare("UPDATE friend_requests SET status = 'cancelled' WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").run(userId, friendId, friendId, userId);
  return c.json({ success: true });
});

app.post("/api/friends/regular/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const friendId = c.req.param("id");
  const body = await c.req.json();
  const isRegular = body.isRegular === true || body.isRegular === 1;

  const friendship = db.prepare("SELECT * FROM friendships WHERE user_id = ? AND friend_id = ?").get(userId, friendId) as any;
  if (!friendship) return c.json({ error: "Not friends" }, 404);

  db.prepare("UPDATE friendships SET is_regular = ? WHERE user_id = ? AND friend_id = ?")
    .run(isRegular ? 1 : 0, userId, friendId);
  return c.json({ isRegular });
});

app.get("/api/users/search", authMiddleware, (c) => {
  const userId = c.get("userId");
  const q = c.req.query("q") || "";
  const users = db.prepare(
    "SELECT id, display_name, home_club FROM users WHERE id != ? AND (display_name LIKE ? OR home_club LIKE ?) LIMIT 20"
  ).all(userId, `%${q}%`, `%${q}%`);
  return c.json(users);
});

// ═══════════════ PLAY INVITATIONS ═══════════════

app.get("/api/play-invitations", authMiddleware, (c) => {
  const userId = c.get("userId");
  const sent = db.prepare(`
    SELECT pi.id, pi.from_id, pi.to_id, pi.message, pi.proposed_date, pi.status, pi.created_at, u.display_name
    FROM play_invitations pi
    JOIN users u ON pi.to_id = u.id
    WHERE pi.from_id = ? AND pi.status = 'pending'
  `).all(userId);
  const received = db.prepare(`
    SELECT pi.id, pi.from_id, pi.to_id, pi.message, pi.proposed_date, pi.status, pi.created_at, u.display_name
    FROM play_invitations pi
    JOIN users u ON pi.from_id = u.id
    WHERE pi.to_id = ? AND pi.status = 'pending'
  `).all(userId);
  return c.json({ sent, received });
});

app.post("/api/play-invitations", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const { toId, message, proposedDate } = body as any;

  if (!toId) return c.json({ error: "Recipient required" }, 400);
  if (toId === userId) return c.json({ error: "Can't invite yourself" }, 400);

  const friend = db.prepare("SELECT id FROM friendships WHERE user_id = ? AND friend_id = ?").get(userId, toId);
  if (!friend) return c.json({ error: "Not friends with recipient" }, 403);

  const existing = db.prepare(`
    SELECT id FROM play_invitations
    WHERE from_id = ? AND to_id = ? AND proposed_date = ? AND status = 'pending'
  `).get(userId, toId, proposedDate || null);
  if (existing) return c.json({ error: "Invitation already sent" }, 409);

  const id = uid();
  const msg = typeof message === "string" ? message.trim() : "";
  const date = typeof proposedDate === "string" && proposedDate ? proposedDate : null;
  db.prepare(`
    INSERT INTO play_invitations (id, from_id, to_id, message, proposed_date, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(id, userId, toId, msg, date);

  return c.json({ id, fromId: userId, toId, message: msg, proposedDate: date, status: "pending" }, 201);
});

app.post("/api/play-invitations/:id/accept", authMiddleware, (c) => {
  const userId = c.get("userId");
  const inviteId = c.req.param("id");
  const invite = db.prepare("SELECT * FROM play_invitations WHERE id = ? AND to_id = ? AND status = 'pending'").get(inviteId, userId) as any;
  if (!invite) return c.json({ error: "Invitation not found" }, 404);

  db.prepare("UPDATE play_invitations SET status = 'accepted', updated_at = datetime('now') WHERE id = ?").run(inviteId);
  return c.json({ success: true });
});

app.post("/api/play-invitations/:id/decline", authMiddleware, (c) => {
  const userId = c.get("userId");
  const inviteId = c.req.param("id");
  db.prepare("UPDATE play_invitations SET status = 'declined', updated_at = datetime('now') WHERE id = ? AND to_id = ? AND status = 'pending'").run(inviteId, userId);
  return c.json({ success: true });
});

// ═══════════════ ROUNDS ═══════════════

app.get("/api/rounds", authMiddleware, (c) => {
  const userId = c.get("userId");
  const rounds = db.prepare(`
    SELECT r.* FROM rounds r
    JOIN round_participants rp ON r.id = rp.round_id
    WHERE rp.player_id = ? AND r.status != 'disputed'
    ORDER BY r.date ASC
  `).all(userId) as any[];

  // Batch-load participants for all returned rounds
  if (rounds.length > 0) {
    const roundIds = rounds.map((r) => r.id);
    const placeholders = roundIds.map(() => "?").join(",");
    const participants = db.prepare(`
      SELECT rp.*, u.display_name as player_name FROM round_participants rp
      JOIN users u ON rp.player_id = u.id
      WHERE rp.round_id IN (${placeholders})
      ORDER BY rp.player_id ASC
    `).all(...roundIds) as any[];

    const partsByRound = new Map<string, any[]>();
    for (const p of participants) {
      if (!partsByRound.has(p.round_id)) partsByRound.set(p.round_id, []);
      partsByRound.get(p.round_id)!.push(p);
    }

    const analyses = db.prepare(`
      SELECT round_id, narration, flagged, flag_reason FROM ai_analysis
      WHERE round_id IN (${placeholders})
    `).all(...roundIds) as any[];
    const analysisByRound = new Map(analyses.map((a) => [a.round_id, a]));

    for (const r of rounds) {
      r.participants = partsByRound.get(r.id) ?? [];
      const analysis = analysisByRound.get(r.id);
      if (analysis) {
        r.aiAnalysis = {
          narration: analysis.narration ?? undefined,
          flagged: !!analysis.flagged,
          flagReason: analysis.flag_reason ?? undefined,
        };
      }
    }
  }

  return c.json(rounds);
});

app.post("/api/rounds", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json() as any;

  // Shared validation boundary — same as client-side
  const result = validateRound(body);
  if (!result.ok) {
    const msg = result.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
    return c.json({ error: msg }, 400);
  }

  const { date, format, course, par, holes, nine, participants } = result.data;

  // Verify all participants are friends
  for (const p of participants) {
    if (p.playerId === userId) continue;
    const friend = db.prepare("SELECT id FROM friendships WHERE user_id = ? AND friend_id = ?").get(userId, p.playerId);
    if (!friend) return c.json({ error: `Not friends with participant ${p.playerId}` }, 403);
  }

  const roundId = uid();
  const createRound = db.transaction(() => {
    db.prepare(`INSERT INTO rounds (id, logged_by, date, format, course, par, holes, nine)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(roundId, userId, date, format, course, par, holes, nine);

    for (const p of participants) {
      db.prepare(`INSERT INTO round_participants (id, round_id, player_id, ags, holes_won, points, cr, slope, pcc)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uid(), roundId, p.playerId, p.ags ?? null, p.holesWon ?? null, p.points ?? null, p.cr, p.slope, p.pcc);
    }

    // Create attestation records for opponents
    for (const p of participants) {
      if (p.playerId === userId) continue;
      db.prepare("INSERT INTO attestations (id, round_id, from_id, to_id) VALUES (?, ?, ?, ?)")
        .run(uid(), roundId, userId, p.playerId);
    }
  });
  createRound();

  // Auto-confirm if all participants are FORM users who are mutual friends
  // For now, rounds logged by users go to pending_attestation

  return c.json({ id: roundId, status: "pending_attestation" }, 201);
});

app.get("/api/rounds/:id", authMiddleware, (c) => {
  const userId = c.get("userId");
  const roundId = c.req.param("id");

  const round = db.prepare(`
    SELECT r.*, u.display_name as logged_by_name FROM rounds r
    JOIN users u ON r.logged_by = u.id
    WHERE r.id = ?
  `).get(roundId) as any;
  if (!round) return c.json({ error: "Not found" }, 404);

  // User must be a participant or the logger to view
  const participant = db.prepare("SELECT 1 FROM round_participants WHERE round_id = ? AND player_id = ?")
    .get(roundId, userId);
  const isLogger = round.logged_by === userId;
  if (!participant && !isLogger) return c.json({ error: "Forbidden" }, 403);

  const participants = db.prepare(`
    SELECT rp.*, u.display_name as player_name FROM round_participants rp
    JOIN users u ON rp.player_id = u.id
    WHERE rp.round_id = ?
    ORDER BY rp.player_id ASC
  `).all(roundId);

  const analysis = db.prepare(
    "SELECT narration, flagged, flag_reason FROM ai_analysis WHERE round_id = ?"
  ).get(roundId) as any;
  const aiAnalysis = analysis
    ? { narration: analysis.narration ?? undefined, flagged: !!analysis.flagged, flagReason: analysis.flag_reason ?? undefined }
    : undefined;

  return c.json({ ...round, participants, aiAnalysis });
});

// ═══════════════ REPLAY ═══════════════

import { validateRound, type ValidatedRound } from "../../engine/validation.js";
import { replay, DEFAULTS, alphaMatchFromFactor, type Player, type Round, type Participant, brierScore, logLoss } from "../../engine/index.js";
import { seed } from "./db/seed.js";

function buildReplayData(userId: string) {
  // Get all confirmed rounds from the user's network (friends + self)
  const friendIds = db.prepare("SELECT friend_id FROM friendships WHERE user_id = ?").all(userId) as any[];
  const ids = [userId, ...friendIds.map((f: any) => f.friend_id)];
  const placeholders = ids.map(() => "?").join(",");

  const roundRows = db.prepare(`
    SELECT DISTINCT r.* FROM rounds r
    JOIN round_participants rp ON r.id = rp.round_id
    WHERE r.status != 'disputed'
    AND rp.player_id IN (${placeholders})
    ORDER BY r.date ASC
  `).all(...ids) as any[];

  // Collect all unique player IDs from these rounds
  // Always include the current user so they see their seeded rating even with 0 rounds
  const playerIds = new Set<string>([userId]);
  const participantRows: any[] = [];

  // Batch query all participants for all rounds (fixes N+1)
  if (roundRows.length > 0) {
    const roundIds = roundRows.map((r: any) => r.id);
    const rPlaceholders = roundIds.map(() => "?").join(",");
    const allParts = db.prepare(`
      SELECT rp.*, r.format, r.date, r.course, r.par, r.holes, r.nine, rp.round_id AS roundId
      FROM round_participants rp
      JOIN rounds r ON rp.round_id = r.id
      WHERE rp.round_id IN (${rPlaceholders})
    `).all(...roundIds) as any[];
    for (const p of allParts) {
      playerIds.add(p.player_id);
      participantRows.push(p);
    }
  }

  // Batch query all player info (fixes N+1)
  const playerIdArr = [...playerIds];
  const pPlaceholders = playerIdArr.map(() => "?").join(",");
  const users = db.prepare(
    `SELECT id, display_name, home_club, sga_handicap FROM users WHERE id IN (${pPlaceholders})`
  ).all(...playerIdArr) as any[];

  // Build Player list from batch result
  const userMap = new Map(users.map((u: any) => [u.id, u]));
  const players: Player[] = [];
  for (const pid of playerIds) {
    const u = userMap.get(pid);
    if (u) {
      players.push({
        id: u.id,
        name: u.display_name || u.id.slice(0, 6),
        club: u.home_club || "",
        seed: u.sga_handicap ?? undefined,
      });
    }
  }

  // Build rounds
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
        cr: 0,
        slope: 113,
        pcc: 0,
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

app.get("/api/replay", authMiddleware, (c) => {
  const userId = c.get("userId");
  const { players, rounds } = buildReplayData(userId);
  // Always run replay — even with 0 rounds, it returns players with seeded ratings
  const result = replay(players, rounds, DEFAULTS);

  // Augment each player with isPro from the database
  const proIds = new Set<string>();
  for (const p of players) {
    const u = db.prepare("SELECT is_pro FROM users WHERE id = ?").get(p.id) as any;
    if (u?.is_pro) proIds.add(p.id);
  }
  result.players = result.players.map((p) => ({
    ...p,
    isPro: proIds.has(p.id),
  }));

  // Join anomaly-detection flags so the UI can surface them without a
  // second fetch — same ai_analysis data /api/rounds already returns.
  if (result.rounds.length > 0) {
    const roundIds = result.rounds.map((r) => r.id);
    const placeholders = roundIds.map(() => "?").join(",");
    const analyses = db.prepare(`
      SELECT round_id, flagged, flag_reason FROM ai_analysis
      WHERE round_id IN (${placeholders})
    `).all(...roundIds) as any[];
    const analysisByRound = new Map(analyses.map((a) => [a.round_id, a]));

    result.rounds = result.rounds.map((r) => {
      const analysis = analysisByRound.get(r.id);
      return analysis
        ? { ...r, flagged: !!analysis.flagged, flagReason: analysis.flag_reason ?? undefined }
        : r;
    });
  }

  return c.json(result);
});

// ═══════════════ RANKINGS & PROS ═══════════════

type RankingsScope = "friends" | "club" | "global";

/** Build replay data for a set of specific user IDs (not the caller's network). */
function buildReplayDataForUsers(userIds: string[]) {
  if (userIds.length === 0) return { players: [] as Player[], rounds: [] as Round[] };

  const placeholders = userIds.map(() => "?").join(",");

  const roundRows = db.prepare(`
    SELECT DISTINCT r.* FROM rounds r
    JOIN round_participants rp ON r.id = rp.round_id
    WHERE r.status != 'disputed'
    AND rp.player_id IN (${placeholders})
    ORDER BY r.date ASC
  `).all(...userIds) as any[];

  const playerIds = new Set<string>(userIds);
  const participantRows: any[] = [];

  if (roundRows.length > 0) {
    const roundIds = roundRows.map((r: any) => r.id);
    const rPlaceholders = roundIds.map(() => "?").join(",");
    const allParts = db.prepare(`
      SELECT rp.*, r.format, r.date, r.course, r.par, r.holes, r.nine, rp.round_id AS roundId
      FROM round_participants rp
      JOIN rounds r ON rp.round_id = r.id
      WHERE rp.round_id IN (${rPlaceholders})
    `).all(...roundIds) as any[];
    for (const p of allParts) {
      playerIds.add(p.player_id);
      participantRows.push(p);
    }
  }

  const playerIdArr = [...playerIds];
  const pPlaceholders = playerIdArr.map(() => "?").join(",");
  const users = db.prepare(
    `SELECT id, display_name, home_club, sga_handicap, is_pro FROM users WHERE id IN (${pPlaceholders})`
  ).all(...playerIdArr) as any[];

  const userMap = new Map(users.map((u: any) => [u.id, u]));
  const players: Player[] = [];
  for (const pid of playerIds) {
    const u = userMap.get(pid);
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
      round.participants.push({ playerId: pr.player_id, holesWon: pr.holes_won || 0 } as any);
    } else if (pr.format === "stableford") {
      round.participants.push({ playerId: pr.player_id, points: pr.points || 0, cr: pr.cr, slope: pr.slope, pcc: pr.pcc || 0 } as any);
    } else {
      round.participants.push({ playerId: pr.player_id, ags: pr.ags || 0, cr: pr.cr, slope: pr.slope, pcc: pr.pcc || 0 } as any);
    }
  }

  return { players, rounds: [...roundMap.values()] };
}

app.get("/api/rankings", authMiddleware, (c) => {
  const userId = c.get("userId");
  const scope = (c.req.query("scope") || "friends") as RankingsScope;

  let targetIds: string[] = [];

  if (scope === "club") {
    const user = db.prepare("SELECT home_club FROM users WHERE id = ?").get(userId) as any;
    const club = user?.home_club;
    if (club) {
      const rows = db.prepare(
        "SELECT id FROM users WHERE home_club = ? AND id != ? AND is_public = 1"
      ).all(club, userId) as any[];
      targetIds = [userId, ...rows.map((r: any) => r.id)];
    } else {
      targetIds = [userId];
    }
  } else if (scope === "global") {
    const rows = db.prepare(
      "SELECT id FROM users WHERE is_public = 1"
    ).all() as any[];
    targetIds = rows.map((r: any) => r.id);
    if (!targetIds.includes(userId)) targetIds.unshift(userId);
  } else {
    // friends (default)
    const friendRows = db.prepare(
      "SELECT friend_id FROM friendships WHERE user_id = ?"
    ).all(userId) as any[];
    targetIds = [userId, ...friendRows.map((r: any) => r.friend_id)];
  }

  const { players, rounds } = buildReplayDataForUsers(targetIds);
  const result = replay(players, rounds, DEFAULTS);

  // Sort by rating descending, then annotate with rank and display fields
  const sorted = result.players
    .filter((p) => p.rating != null)
    .sort((a, b) => b.rating - a.rating);

  const userMap = new Map<string, any>();
  for (const pid of targetIds) {
    const u = db.prepare("SELECT id, display_name, home_club, is_pro FROM users WHERE id = ?").get(pid) as any;
    if (u) userMap.set(u.id, u);
  }

  const rankings = sorted.map((p, i) => {
    const u = userMap.get(p.id);
    return {
      rank: i + 1,
      playerId: p.id,
      displayName: u?.display_name || p.name,
      homeClub: u?.home_club || p.club,
      rating: Math.round(p.rating),
      matches: p.matches,
      hcpIndex: p.hcpIndex,
      isProvisional: p.isProvisional,
      isPro: !!u?.is_pro,
    };
  });

  return c.json({ scope, rankings });
});

app.get("/api/pros", authMiddleware, (c) => {
  const userId = c.get("userId");

  // Get all pro players
  const proRows = db.prepare(
    "SELECT id FROM users WHERE is_pro = 1"
  ).all() as any[];
  const proIds = proRows.map((r: any) => r.id);

  // Use the user's full network replay for accurate userRating,
  // then merge pro ratings from a replay that includes the pros
  const userResult = replay(...(() => {
    const d = buildReplayData(userId);
    return [d.players, d.rounds, DEFAULTS] as const;
  })());

  const userState = userResult.players.find((p) => p.id === userId);
  const userRating = userState ? {
    playerId: userId,
    rating: Math.round(userState.rating),
    matches: userState.matches,
    hcpIndex: userState.hcpIndex,
    isProvisional: userState.isProvisional,
  } : null;

  if (proIds.length === 0) {
    return c.json({ pros: [], userRating });
  }

  // Build pro replay: include caller + pros + any shared opponents
  const { players: proPlayers, rounds: proRounds } = buildReplayDataForUsers([userId, ...proIds]);
  const proResult = replay(proPlayers, proRounds, DEFAULTS);

  const proMap = new Map<string, any>();
  for (const pid of proIds) {
    const u = db.prepare("SELECT id, display_name, home_club, sga_handicap FROM users WHERE id = ?").get(pid) as any;
    if (u) proMap.set(u.id, u);
  }

  const pros = proResult.players
    .filter((p) => proMap.has(p.id))
    .sort((a, b) => b.rating - a.rating)
    .map((p, i) => {
      const u = proMap.get(p.id);
      return {
        rank: i + 1,
        playerId: p.id,
        displayName: u.display_name || p.name,
        homeClub: u.home_club || "",
        sgaHandicap: u.sga_handicap ?? null,
        rating: Math.round(p.rating),
        matches: p.matches,
        hcpIndex: p.hcpIndex,
        isProvisional: p.isProvisional,
      };
    });

  return c.json({ pros, userRating });
});

// ═══════════════ ATTESTATION ═══════════════

app.get("/api/attestations", authMiddleware, (c) => {
  const userId = c.get("userId");
  const attestations = db.prepare(`
    SELECT a.*, r.date, r.format, r.course, u.display_name as from_name FROM attestations a
    JOIN rounds r ON a.round_id = r.id
    JOIN users u ON a.from_id = u.id
    WHERE a.to_id = ? AND a.status = 'pending'
    ORDER BY r.date DESC
  `).all(userId);
  return c.json(attestations);
});

app.post("/api/attestations/:id/confirm", authMiddleware, (c) => {
  const userId = c.get("userId");
  const attestId = c.req.param("id");
  const a = db.prepare("SELECT * FROM attestations WHERE id = ? AND to_id = ? AND status = 'pending'").get(attestId, userId) as any;
  if (!a) return c.json({ error: "Not found" }, 404);

  // Use a transaction to avoid race condition when multiple users confirm simultaneously
  let fullyConfirmed = false;
  const doConfirm = db.transaction(() => {
    db.prepare("UPDATE attestations SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = ?").run(attestId);

    // Check if all attestations for this round are now confirmed (atomic within transaction)
    const pending = db.prepare("SELECT COUNT(*) as c FROM attestations WHERE round_id = ? AND status = 'pending'").get(a.round_id) as any;
    if (pending.c === 0) {
      db.prepare("UPDATE rounds SET status = 'confirmed' WHERE id = ?").run(a.round_id);
      fullyConfirmed = true;
    }
  });
  doConfirm();

  // Run anomaly detection for every participant now that the round is fully
  // attested — outside the transaction above since it opens its own writes.
  // Best-effort: a detection failure must never block confirmation itself.
  if (fullyConfirmed) {
    const participantIds = db
      .prepare("SELECT DISTINCT player_id FROM round_participants WHERE round_id = ?")
      .all(a.round_id) as { player_id: string }[];
    for (const { player_id } of participantIds) {
      try {
        runAnomalyDetectionForUser(player_id);
      } catch (err) {
        console.error(`Anomaly detection failed for user ${player_id}:`, err);
      }
    }
  }

  return c.json({ success: true });
});

app.post("/api/attestations/:id/dispute", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const attestId = c.req.param("id");
  const a = db.prepare("SELECT * FROM attestations WHERE id = ? AND to_id = ? AND status = 'pending'").get(attestId, userId) as any;
  if (!a) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => ({})) as any;

  const doDispute = db.transaction(() => {
    // Optional corrected participant scores from the disputer
    if (body.participants && Array.isArray(body.participants)) {
      const round = db.prepare("SELECT format FROM rounds WHERE id = ?").get(a.round_id) as any;
      if (!round) throw new Error("Round not found");

      for (const p of body.participants) {
        if (!p.playerId) continue;
        const existing = db.prepare("SELECT id FROM round_participants WHERE round_id = ? AND player_id = ?")
          .get(a.round_id, p.playerId);
        if (!existing) continue;

        if (round.format === "match") {
          db.prepare("UPDATE round_participants SET holes_won = ? WHERE round_id = ? AND player_id = ?")
            .run(p.holesWon ?? 0, a.round_id, p.playerId);
        } else if (round.format === "stableford") {
          db.prepare("UPDATE round_participants SET points = ? WHERE round_id = ? AND player_id = ?")
            .run(p.points ?? 0, a.round_id, p.playerId);
        } else {
          db.prepare("UPDATE round_participants SET ags = ? WHERE round_id = ? AND player_id = ?")
            .run(p.ags ?? 0, a.round_id, p.playerId);
        }
      }
    }

    // Mark original attestation as disputed
    db.prepare("UPDATE attestations SET status = 'disputed' WHERE id = ?").run(attestId);

    // Create a reverse attestation so the original logger must confirm the correction
    db.prepare("INSERT INTO attestations (id, round_id, from_id, to_id) VALUES (?, ?, ?, ?)")
      .run(uid(), a.round_id, userId, a.from_id);

    // Reset round to pending attestation so it remains unconfirmed until the logger confirms
    db.prepare("UPDATE rounds SET status = 'pending_attestation' WHERE id = ?").run(a.round_id);
  });

  try {
    doDispute();
  } catch (err: any) {
    return c.json({ error: err.message }, 404);
  }

  return c.json({ success: true });
});

// ═══════════════ COURSES ═══════════════

app.get("/api/courses", authMiddleware, (c) => {
  const courses = db.prepare("SELECT * FROM courses").all() as any[];
  const result = courses.map((c: any) => {
    const tees = db.prepare("SELECT * FROM tees WHERE course_id = ?").all(c.id);
    return { ...c, tees, verified: !!c.verified };
  });
  return c.json(result);
});

app.post("/api/courses", authMiddleware, adminMiddleware, async (c) => {
  const body = await c.req.json() as any;
  const id = uid();
  db.prepare("INSERT INTO courses (id, name, club, verified, source) VALUES (?, ?, ?, ?, ?)")
    .run(id, body.name, body.club, body.verified ? 1 : 0, body.source || null);
  if (body.tees) {
    for (const t of body.tees) {
      db.prepare(`INSERT INTO tees (id, course_id, name, colour, yardage, par, cr, slope)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uid(), id, t.name, t.colour, t.yardage, t.par, t.cr, t.slope);
    }
  }
  return c.json({ id, ...body }, 201);
});

// Update course — authenticated, admin only
app.patch("/api/courses/:id", authMiddleware, adminMiddleware, async (c) => {
  const courseId = c.req.param("id");
  const existing = db.prepare("SELECT id FROM courses WHERE id = ?").get(courseId) as any;
  if (!existing) return c.json({ error: "Course not found" }, 404);

  const body = await c.req.json() as any;
  const updates: string[] = [];
  const values: any[] = [];

  if (body.name !== undefined) { updates.push("name = ?"); values.push(body.name); }
  if (body.club !== undefined) { updates.push("club = ?"); values.push(body.club); }
  if (body.verified !== undefined) { updates.push("verified = ?"); values.push(body.verified ? 1 : 0); }
  if (body.source !== undefined) { updates.push("source = ?"); values.push(body.source); }

  if (updates.length > 0) {
    values.push(courseId);
    db.prepare(`UPDATE courses SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  }

  // Handle tees: delete existing and re-insert if provided
  if (body.tees !== undefined) {
    db.prepare("DELETE FROM tees WHERE course_id = ?").run(courseId);
    for (const t of body.tees) {
      db.prepare(`INSERT INTO tees (id, course_id, name, colour, yardage, par, cr, slope, cr9, slope9, front_cr, front_slope, back_cr, back_slope)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uid(), courseId, t.name, t.colour, t.yardage, t.par, t.cr, t.slope,
          t.cr9 || null, t.slope9 || null,
          t.front_cr || null, t.front_slope || null,
          t.back_cr || null, t.back_slope || null);
    }
  }

  // Return updated course with tees
  const course = db.prepare("SELECT * FROM courses WHERE id = ?").get(courseId) as any;
  const tees = db.prepare("SELECT * FROM tees WHERE course_id = ?").all(courseId);
  return c.json({ ...course, tees, verified: !!course.verified });
});

// ═══════════════ CONFIG ═══════════════

app.get("/api/config", authMiddleware, (c) => {
  const row = db.prepare("SELECT value FROM config WHERE key = 'engine'").get() as any;
  return c.json(row ? JSON.parse(row.value) : {});
});

app.patch("/api/config", authMiddleware, adminMiddleware, async (c) => {
  const body = await c.req.json() as any;
  const existing = db.prepare("SELECT value FROM config WHERE key = 'engine'").get() as any;
  const config = existing ? JSON.parse(existing.value) : {};
  Object.assign(config, body);

  // alphaMatch is derived from alphaStroke * matchStrokeFactor (the
  // essay's own relationship) — recompute it whenever either input
  // changes, unless this same request also sets alphaMatch explicitly
  // (an intentional direct override takes precedence over the derivation).
  if (("alphaStroke" in body || "matchStrokeFactor" in body) && !("alphaMatch" in body)) {
    const alphaStroke = config.alphaStroke ?? DEFAULTS.alphaStroke;
    const matchStrokeFactor = config.matchStrokeFactor ?? DEFAULTS.matchStrokeFactor;
    config.alphaMatch = alphaMatchFromFactor(alphaStroke, matchStrokeFactor);
  }

  db.prepare("UPDATE config SET value = ? WHERE key = 'engine'").run(JSON.stringify(config));
  return c.json(config);
});

// ═══════════════ ADMIN ═══════════════

// AI configuration status — expose to admin panel
app.get("/api/admin/ai-config", authMiddleware, adminMiddleware, (c) => {
  const config = getAIConfig();
  return c.json({
    enabled: config.enabled,
    endpoint: config.endpoint,
    model: config.model,
    // Mask the key — show first 8 and last 4 chars
    apiKey: config.apiKey
      ? config.apiKey.slice(0, 8) + "..." + config.apiKey.slice(-4)
      : null,
  });
});

app.get("/api/admin/stats", authMiddleware, adminMiddleware, (c) => {
  const users = db.prepare("SELECT COUNT(*) as c FROM users").get() as any;
  const rounds = db.prepare("SELECT COUNT(*) as c FROM rounds").get() as any;
  const confirmed = db.prepare("SELECT COUNT(*) as c FROM rounds WHERE status = 'confirmed'").get() as any;
  const courses = db.prepare("SELECT COUNT(*) as c FROM courses").get() as any;
  const friendships = db.prepare("SELECT COUNT(*) as c FROM friendships").get() as any;
  const pending = db.prepare("SELECT COUNT(*) as c FROM friend_requests WHERE status = 'pending'").get() as any;
  const dbSize = db.prepare("PRAGMA page_count").get() as any;
  const dbPageSize = db.prepare("PRAGMA page_size").get() as any;
  const pages = dbSize.page_count || dbSize.c || 0;
  const pageBytes = dbPageSize.page_size || dbPageSize.c || 0;
  const sizeMb = pages && pageBytes ? Math.round(((pages * pageBytes) / (1024 * 1024)) * 100) / 100 : null;
  return c.json({
    users: users.c,
    rounds: rounds.c,
    confirmedRounds: confirmed.c,
    courses: courses.c,
    friendships: friendships.c,
    pendingRequests: pending.c,
    dbSizeMb: sizeMb,
    uptime: process.uptime().toFixed(1),
    nodeVersion: process.version,
  });
});

app.get("/api/admin/users", authMiddleware, adminMiddleware, (c) => {
  const users = db.prepare("SELECT id, email, display_name, home_club, sga_handicap, is_admin, is_suspended, created_at FROM users").all();
  return c.json(users);
});

app.post("/api/admin/users", authMiddleware, adminMiddleware, async (c) => {
  const body = await c.req.json();
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    displayName: z.string().min(1).max(100),
    homeClub: z.string().max(100).optional(),
    sgaHandicap: z.number().min(-10).max(54).optional(),
    isAdmin: z.boolean().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400);

  const { email, password, displayName, homeClub, sgaHandicap, isAdmin } = parsed.data;
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return c.json({ error: "Email already registered" }, 409);

  const id = uid();
  const pwHash = await hash(password);
  db.prepare(`INSERT INTO users (id, email, password_hash, display_name, home_club, sga_handicap, is_admin)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, email, pwHash, displayName, homeClub || null, sgaHandicap ?? null, isAdmin ? 1 : 0);

  return c.json({ id, email, displayName, homeClub, sgaHandicap, isAdmin: !!isAdmin }, 201);
});

app.delete("/api/admin/users/:id", authMiddleware, adminMiddleware, (c) => {
  const targetId = c.req.param("id");
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(targetId);
  if (!user) return c.json({ error: "User not found" }, 404);

  db.prepare("DELETE FROM friendships WHERE user_id = ? OR friend_id = ?").run(targetId, targetId);
  db.prepare("DELETE FROM friend_requests WHERE from_id = ? OR to_id = ?").run(targetId, targetId);
  db.prepare("DELETE FROM attestations WHERE from_id = ? OR to_id = ?").run(targetId, targetId);
  db.prepare("DELETE FROM round_participants WHERE player_id = ?").run(targetId);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(targetId);
  db.prepare("DELETE FROM users WHERE id = ?").run(targetId);

  return c.json({ success: true });
});

app.patch("/api/admin/users/:id", authMiddleware, adminMiddleware, async (c) => {
  const targetId = c.req.param("id");
  const body = await c.req.json();

  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(targetId);
  if (!user) return c.json({ error: "User not found" }, 404);

  const updates: string[] = [];
  const values: any[] = [];

  if (body.displayName !== undefined) { updates.push("display_name = ?"); values.push(body.displayName); }
  if (body.homeClub !== undefined) { updates.push("home_club = ?"); values.push(body.homeClub); }
  if (body.sgaHandicap !== undefined) { updates.push("sga_handicap = ?"); values.push(body.sgaHandicap); }
  if (body.isAdmin !== undefined) { updates.push("is_admin = ?"); values.push(body.isAdmin ? 1 : 0); }
  if (body.isSuspended !== undefined) { updates.push("is_suspended = ?"); values.push(body.isSuspended ? 1 : 0); }
  if (body.password) {
    updates.push("password_hash = ?");
    values.push(await hash(body.password));
  }

  if (updates.length === 0) return c.json({ error: "No valid fields" }, 400);

  updates.push("updated_at = datetime('now')");
  values.push(targetId);
  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);

  return c.json({ success: true });
});

app.post("/api/admin/recompute", authMiddleware, adminMiddleware, (c) => {
  // Invalidate any cached replay — next request will recompute
  return c.json({ success: true, message: "Replay cache invalidated" });
});

// Forecast accuracy — compare pre-round expected outcomes to actual results
app.get("/api/admin/forecast", authMiddleware, adminMiddleware, (c) => {
  // Get all confirmed rounds sorted by date
  const roundRows = db.prepare(
    "SELECT * FROM rounds WHERE status = 'confirmed' ORDER BY date ASC"
  ).all() as any[];

  if (roundRows.length === 0) {
    return c.json({ brierScore: 0, logLoss: 0, sampleSize: 0 });
  }

  // Collect all unique player IDs
  const playerIds = new Set<string>();
  const allParticipants: any[] = [];

  for (const r of roundRows) {
    const parts = db.prepare("SELECT * FROM round_participants WHERE round_id = ?").all(r.id) as any[];
    for (const p of parts) {
      playerIds.add(p.player_id);
      allParticipants.push({ ...p, roundId: r.id, format: r.format, date: r.date, course: r.course, par: r.par, holes: r.holes, nine: r.nine });
    }
  }

  // Build engine Player list
  const playerList: Player[] = [];
  for (const pid of playerIds) {
    const u = db.prepare("SELECT id, display_name, home_club, sga_handicap FROM users WHERE id = ?").get(pid) as any;
    if (u) {
      playerList.push({
        id: u.id,
        name: u.display_name || u.id.slice(0, 6),
        club: u.home_club || "",
        seed: u.sga_handicap ?? undefined,
      });
    }
  }

  // Build engine Round list
  const roundMap = new Map<string, Round>();
  for (const pr of allParticipants) {
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
      round.participants.push({ playerId: pr.player_id, holesWon: pr.holes_won || 0 } as any);
    } else if (pr.format === "stableford") {
      round.participants.push({ playerId: pr.player_id, points: pr.points || 0, cr: pr.cr, slope: pr.slope, pcc: pr.pcc || 0 } as any);
    } else {
      round.participants.push({ playerId: pr.player_id, ags: pr.ags || 0, cr: pr.cr, slope: pr.slope, pcc: pr.pcc || 0 } as any);
    }
  }

  const engineRounds = [...roundMap.values()];

  // Get config
  const configRow = db.prepare("SELECT value FROM config WHERE key = 'engine'").get() as any;
  const config = configRow ? { ...DEFAULTS, ...JSON.parse(configRow.value) } : DEFAULTS;

  // Run replay to get per-round predictions
  const result = replay(playerList, engineRounds, config);

  // Collect pairwise predictions vs actuals from every replayed round
  const predictions: { predicted: number; actual: number }[] = [];
  for (const rr of result.rounds) {
    for (const pair of rr.pairs) {
      predictions.push({ predicted: pair.expected, actual: pair.score });
    }
  }

  const bScore = brierScore(predictions);
  const lLoss = logLoss(predictions);

  return c.json({
    brierScore: Math.round(bScore * 10000) / 10000,
    logLoss: Math.round(lLoss * 10000) / 10000,
    sampleSize: predictions.length,
  });
});

// Reset environment — drops ALL data and re-seeds only admin, courses, and
// famous pro players. No demo users or synthetic rounds are created.
app.post("/api/admin/seed", authMiddleware, adminMiddleware, async (c) => {
  try {
    // Drop and recreate tables
    db.exec(`
      DROP TABLE IF EXISTS forecast_cache;
      DROP TABLE IF EXISTS ai_analysis;
      DROP TABLE IF EXISTS attestations;
      DROP TABLE IF EXISTS friend_requests;
      DROP TABLE IF EXISTS friendships;
      DROP TABLE IF EXISTS round_participants;
      DROP TABLE IF EXISTS rounds;
      DROP TABLE IF EXISTS tees;
      DROP TABLE IF EXISTS courses;
      DROP TABLE IF EXISTS password_resets;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS config;
      DROP TABLE IF EXISTS users;
    `);
    await seed();
    return c.json({ success: true, message: "Environment reset: only admin, courses, and pro players seeded. All user data was removed." });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Trigger pro player handicap refresh — uses AI if available, rule-based fallback
app.post("/api/admin/refresh-pros", authMiddleware, adminMiddleware, async (c) => {
  try {
    const result = await refreshProHandicaps();
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Clear all data and re-run migrations
app.post("/api/admin/clear", authMiddleware, adminMiddleware, (c) => {
  try {
    db.exec(`
      DROP TABLE IF EXISTS forecast_cache;
      DROP TABLE IF EXISTS ai_analysis;
      DROP TABLE IF EXISTS attestations;
      DROP TABLE IF EXISTS friend_requests;
      DROP TABLE IF EXISTS friendships;
      DROP TABLE IF EXISTS round_participants;
      DROP TABLE IF EXISTS rounds;
      DROP TABLE IF EXISTS tees;
      DROP TABLE IF EXISTS courses;
      DROP TABLE IF EXISTS password_resets;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS config;
      DROP TABLE IF EXISTS users;
    `);
    runMigrations();
    return c.json({ success: true, message: "All data cleared, migrations re-run" });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Admin-facing engine config — requires admin auth
app.get("/api/admin/config", authMiddleware, adminMiddleware, (c) => {
  const row = db.prepare("SELECT value FROM config WHERE key = 'engine'").get() as any;
  const stored = row ? JSON.parse(row.value) : {};
  return c.json({ ...DEFAULTS, ...stored });
});

app.patch("/api/admin/config", authMiddleware, adminMiddleware, async (c) => {
  const body = await c.req.json() as any;
  const existing = db.prepare("SELECT value FROM config WHERE key = 'engine'").get() as any;
  const config = existing ? JSON.parse(existing.value) : {};
  Object.assign(config, body);
  db.prepare("UPDATE config SET value = ? WHERE key = 'engine'").run(JSON.stringify(config));
  return c.json({ ...DEFAULTS, ...config });
});

// Admin-facing courses — list, create, update with admin auth
app.get("/api/admin/courses", authMiddleware, adminMiddleware, (c) => {
  const courses = db.prepare("SELECT * FROM courses").all() as any[];
  const result = courses.map((c: any) => {
    const tees = db.prepare("SELECT * FROM tees WHERE course_id = ?").all(c.id);
    return { ...c, tees, verified: !!c.verified };
  });
  return c.json(result);
});

app.post("/api/admin/courses", authMiddleware, adminMiddleware, async (c) => {
  const body = await c.req.json() as any;
  const id = uid();
  db.prepare("INSERT INTO courses (id, name, club, verified, source) VALUES (?, ?, ?, ?, ?)")
    .run(id, body.name, body.club, body.verified ? 1 : 0, body.source || null);
  if (body.tees) {
    for (const t of body.tees) {
      db.prepare(`INSERT INTO tees (id, course_id, name, colour, yardage, par, cr, slope, cr9, slope9, front_cr, front_slope, back_cr, back_slope)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uid(), id, t.name, t.colour, t.yardage, t.par, t.cr, t.slope,
          t.cr9 || null, t.slope9 || null,
          t.front_cr || null, t.front_slope || null,
          t.back_cr || null, t.back_slope || null);
    }
  }
  return c.json({ id, ...body }, 201);
});

app.patch("/api/admin/courses/:id", authMiddleware, adminMiddleware, async (c) => {
  const courseId = c.req.param("id");
  const existing = db.prepare("SELECT id FROM courses WHERE id = ?").get(courseId) as any;
  if (!existing) return c.json({ error: "Course not found" }, 404);

  const body = await c.req.json() as any;
  const updates: string[] = [];
  const values: any[] = [];

  if (body.name !== undefined) { updates.push("name = ?"); values.push(body.name); }
  if (body.club !== undefined) { updates.push("club = ?"); values.push(body.club); }
  if (body.verified !== undefined) { updates.push("verified = ?"); values.push(body.verified ? 1 : 0); }
  if (body.source !== undefined) { updates.push("source = ?"); values.push(body.source); }

  if (updates.length > 0) {
    values.push(courseId);
    db.prepare(`UPDATE courses SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  }

  if (body.tees !== undefined) {
    db.prepare("DELETE FROM tees WHERE course_id = ?").run(courseId);
    for (const t of body.tees) {
      db.prepare(`INSERT INTO tees (id, course_id, name, colour, yardage, par, cr, slope, cr9, slope9, front_cr, front_slope, back_cr, back_slope)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uid(), courseId, t.name, t.colour, t.yardage, t.par, t.cr, t.slope,
          t.cr9 || null, t.slope9 || null,
          t.front_cr || null, t.front_slope || null,
          t.back_cr || null, t.back_slope || null);
    }
  }

  const course = db.prepare("SELECT * FROM courses WHERE id = ?").get(courseId) as any;
  const tees = db.prepare("SELECT * FROM tees WHERE course_id = ?").all(courseId);
  return c.json({ ...course, tees, verified: !!course.verified });
});

app.delete("/api/admin/courses/:id", authMiddleware, adminMiddleware, (c) => {
  const courseId = c.req.param("id");
  const existing = db.prepare("SELECT id FROM courses WHERE id = ?").get(courseId) as any;
  if (!existing) return c.json({ error: "Course not found" }, 404);

  db.prepare("DELETE FROM tees WHERE course_id = ?").run(courseId);
  db.prepare("DELETE FROM courses WHERE id = ?").run(courseId);
  return c.json({ success: true });
});

// ═══════════════ ADMIN BACKEND SITE ═══════════════

app.route("/api/admin", adminRoutes);

// ═══════════════ AI ROUTES ═══════════════

app.route("/api/ai", aiRoutes);

app.get("/admin", (c) => {
  // Never cache the admin SPA — it changes frequently and browsers tend to
  // keep the old version, hiding new tabs or fixes from the coach.
  c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  c.header("Pragma", "no-cache");
  c.header("Expires", "0");
  const htmlPath = path.resolve(__dirname, "../../UI/admin-panel/admin.html");
  return c.html(readFileSync(htmlPath, "utf-8"));
});

// ═══════════════ PUBLIC PROFILES ═══════════════

function buildPublicProfile(userId: string) {
  const user = db.prepare(
    "SELECT id, display_name, home_club, region, sga_handicap, is_pro FROM users WHERE id = ? AND is_public = 1"
  ).get(userId) as any;

  if (!user) return null;

  // Build replay data for this user and their network
  const friendIds = db.prepare("SELECT friend_id FROM friendships WHERE user_id = ?").all(userId) as any[];
  const ids = [userId, ...friendIds.map((f: any) => f.friend_id)];
  const placeholders = ids.map(() => "?").join(",");

  const roundRows = db.prepare(`
    SELECT DISTINCT r.* FROM rounds r
    JOIN round_participants rp ON r.id = rp.round_id
    WHERE r.status != 'disputed'
    AND rp.player_id IN (${placeholders})
    ORDER BY r.date ASC
  `).all(...ids) as any[];

  // Collect all unique player IDs and batch query participants (fixes N+1)
  const playerIds = new Set<string>([userId]);
  const participantRows: any[] = [];

  if (roundRows.length > 0) {
    const roundIds = roundRows.map((r: any) => r.id);
    const rPlaceholders = roundIds.map(() => "?").join(",");
    const allParts = db.prepare(`
      SELECT rp.*, r.format, r.date, r.course, r.par, r.holes, r.nine, rp.round_id AS roundId
      FROM round_participants rp
      JOIN rounds r ON rp.round_id = r.id
      WHERE rp.round_id IN (${rPlaceholders})
    `).all(...roundIds) as any[];
    for (const p of allParts) {
      playerIds.add(p.player_id);
      participantRows.push(p);
    }
  }

  // Batch query all player info (fixes N+1)
  const playerIdArr = [...playerIds];
  const pPlaceholders = playerIdArr.map(() => "?").join(",");
  const users = db.prepare(
    `SELECT id, display_name, home_club, sga_handicap FROM users WHERE id IN (${pPlaceholders})`
  ).all(...playerIdArr) as any[];

  // Build Player list from batch result
  const userMap = new Map(users.map((u: any) => [u.id, u]));
  const players: Player[] = [];
  for (const pid of playerIds) {
    const u = userMap.get(pid);
    if (u) {
      players.push({
        id: u.id,
        name: u.display_name || u.id.slice(0, 6),
        club: u.home_club || "",
        seed: u.sga_handicap ?? undefined,
      });
    }
  }

  // Build Round list
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
      round.participants.push({ playerId: pr.player_id, holesWon: pr.holes_won || 0 } as any);
    } else if (pr.format === "stableford") {
      round.participants.push({ playerId: pr.player_id, points: pr.points || 0, cr: pr.cr, slope: pr.slope, pcc: pr.pcc || 0 } as any);
    } else {
      round.participants.push({ playerId: pr.player_id, ags: pr.ags || 0, cr: pr.cr, slope: pr.slope, pcc: pr.pcc || 0 } as any);
    }
  }

  // Run replay
  const result = replay(players, [...roundMap.values()], DEFAULTS);
  const playerState = result.players.find((p) => p.id === userId);

  return {
    id: user.id,
    displayName: user.display_name,
    homeClub: user.home_club,
    region: user.region,
    isPro: !!user.is_pro,
    rating: playerState?.rating ?? null,
    matches: playerState?.matches ?? 0,
    hcpIndex: playerState?.hcpIndex ?? null,
    rd: playerState?.rd ?? null,
    isProvisional: playerState?.isProvisional ?? true,
    curve: playerState?.curve ?? [],
  };
}

// List all public profiles — supports ?filter=app|pro|all (default: app)
app.get("/api/public-profiles", authMiddleware, (c) => {
  const filter = c.req.query("filter") || "app";
  let query: string;
  if (filter === "pro") {
    query = "SELECT id FROM users WHERE is_public = 1 AND is_pro = 1 ORDER BY display_name ASC";
  } else if (filter === "all") {
    query = "SELECT id FROM users WHERE is_public = 1 ORDER BY display_name ASC";
  } else {
    // default: app users only (not pro)
    query = "SELECT id FROM users WHERE is_public = 1 AND is_pro = 0 ORDER BY display_name ASC";
  }
  const rows = db.prepare(query).all() as Array<{ id: string }>;
  const profiles = rows
    .map((r) => buildPublicProfile(r.id))
    .filter(Boolean)
    .sort((a, b) => (b?.rating ?? 0) - (a?.rating ?? 0));
  return c.json(profiles);
});

// Get a single public profile with replay-based rating and stats
app.get("/api/public-profiles/:id", authMiddleware, (c) => {
  const userId = c.req.param("id");
  const profile = buildPublicProfile(userId);
  if (!profile) return c.json({ error: "Profile not found" }, 404);
  return c.json(profile);
});

// ═══════════════ HEALTH ═══════════════

app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// ═══════════════ STATIC (production) ═══════════════
// In production, serve the single-file built frontend for all non-API routes.
// During development the Vite dev server handles this on port 5173.
const frontendPath = path.resolve(__dirname, "../../UI/served-builds/app.html");
let hasFrontend = false;
try {
  readFileSync(frontendPath); // check it exists
  hasFrontend = true;
} catch {
  console.log("No built frontend found at UI/served-builds/app.html — API-only mode");
}

// Catch-all for unmatched API routes — returns 404 for all HTTP methods
app.notFound((c) => {
  const { path } = c.req;
  if (path.startsWith("/api/") || path === "/admin") {
    return c.json({ error: "Not found" }, 404);
  }
  if (hasFrontend) {
    return c.html(readFileSync(frontendPath, "utf-8"));
  }
  return c.json({ error: "Not found" }, 404);
});

// ═══════════════ START ═══════════════

import { serve } from "@hono/node-server";
import { spawn } from "child_process";

let server: ReturnType<typeof serve>;

// Skip binding a port when running tests (vitest uses app.fetch directly)
if (!process.env.VITEST) {
  server = serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`FORM server running on http://localhost:${info.port}`);
  });
} else {
  server = { close: (cb?: (err?: Error) => void) => { cb?.(); } } as any;
}

// ═══════════════ SERVER CONTROL ═══════════════

app.post("/api/admin/server/shutdown", authMiddleware, adminMiddleware, async (c) => {
  console.log("Shutdown requested via admin panel");
  const resp = c.json({ message: "Server shutting down" });
  setTimeout(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000);
  }, 200);
  return resp;
});

app.post("/api/admin/server/restart", authMiddleware, adminMiddleware, async (c) => {
  console.log("Restart requested via admin panel");
  const resp = c.json({ message: "Server restarting" });

  setTimeout(() => {
    server.close((err) => {
      if (err) console.error("Close error:", err);
      const cwd = process.cwd();
      const logFile = "/tmp/form-restart.log";
      // Use npx tsx explicitly — process.argv won't contain 'npx' when run via npx
      // Capture stderr to a log file so we can debug failures
      spawn("sh", ["-c", `cd "${cwd}" && nohup npx tsx src/index.ts >>"${logFile}" 2>&1 &`], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      }).unref();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000);
  }, 500);

  return resp;
});

export default app;
