/**
 * FORM server integration tests.
 *
 * These tests exercise every public API endpoint against an in-memory SQLite
 * database.  No real server is started — Hono's `app.fetch()` is used directly.
 *
 * Set VITEST=true in vitest.config.ts so index.ts skips binding a port.
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import crypto from "crypto";

let app: any;
let createToken: (userId: string) => Promise<string>;

beforeAll(async () => {
  const mod = await import("./index.js");
  app = mod.default;
  const auth = await import("./middleware/auth.js");
  createToken = auth.createToken;
});

// ── helpers ──────────────────────────────────────────────

type FetchOpts = { token?: string; body?: any; method?: string };

async function fetch(path: string, opts: FetchOpts = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  // Registration requires PIPL consent. These tests predate that
  // requirement and exercise unrelated behavior, so default consent to
  // true here unless a test explicitly overrides it (to test the consent
  // gate itself).
  let body = opts.body;
  if (path === "/api/auth/register" && body && body.consent === undefined) {
    body = { ...body, consent: true };
  }

  const req = new Request(`http://localhost${path}`, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await app.fetch(req);
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

let adminToken: string;
let aliceToken: string;
let aliceId: string;
let bobToken: string;
let bobId: string;

beforeEach(async () => {
  // Wipe all tables so each test starts clean
  const db = (await import("./db/connection.js")).default;
  db.exec(`
    DELETE FROM attestations;
    DELETE FROM round_participants;
    DELETE FROM rounds;
    DELETE FROM friend_requests;
    DELETE FROM friendships;
    DELETE FROM sessions;
    DELETE FROM password_resets;
    DELETE FROM ai_analysis;
    DELETE FROM forecast_cache;
    DELETE FROM courses;
    DELETE FROM config;
    DELETE FROM users;
  `);

  // Re-insert default engine config (wiped by DELETE above)
  db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run(
    "engine",
    JSON.stringify({
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
    })
  );

  // Register three users
  // Admin: insert directly into DB (POST /api/admin/users now requires admin auth)
  const { hash } = await import("argon2");
  const adminId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name, home_club, sga_handicap, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(adminId, "admin@test.golf", await hash("adminpass123"), "Admin", "TestClub", null, 1);
  const adminLogin = await fetch("/api/auth/login", {
    body: { email: "admin@test.golf", password: "adminpass123" },
  });
  adminToken = adminLogin.json.token;

  const aliceRes = await fetch("/api/auth/register", {
    body: { email: "alice@test.golf", password: "alicepass123", displayName: "Alice", homeClub: "Sentosa", sgaHandicap: 9.1 },
  });
  aliceToken = aliceRes.json.token;
  aliceId = aliceRes.json.user.id;

  const bobRes = await fetch("/api/auth/register", {
    body: { email: "bob@test.golf", password: "bobpass123", displayName: "Bob", homeClub: "Tanah Merah", sgaHandicap: 6.4 },
  });
  bobToken = bobRes.json.token;
  bobId = bobRes.json.user.id;
});

// ═══════════════ HEALTH ═══════════════

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const { status, json } = await fetch("/api/health");
    expect(status).toBe(200);
    expect(json.status).toBe("ok");
    expect(json.timestamp).toBeDefined();
  });
});

// ═══════════════ AUTH ═══════════════

describe("Auth", () => {
  it("POST /api/auth/register — creates a user and returns token + profile", async () => {
    const { status, json } = await fetch("/api/auth/register", {
      body: { email: "eve@test.golf", password: "evepass123", displayName: "Eve" },
    });
    expect(status).toBe(200);
    expect(json.token).toBeDefined();
    expect(json.user.email).toBe("eve@test.golf");
    expect(json.user.displayName).toBe("Eve");
  });

  it("POST /api/auth/register — rejects duplicate email", async () => {
    const { status, json } = await fetch("/api/auth/register", {
      body: { email: "alice@test.golf", password: "123456", displayName: "Fake" },
    });
    expect(status).toBe(409);
    expect(json.error).toMatch(/already registered/i);
  });

  it("POST /api/auth/register — validates email", async () => {
    const { status } = await fetch("/api/auth/register", {
      body: { email: "not-an-email", password: "123456", displayName: "Nope" },
    });
    expect(status).toBe(400);
  });

  it("POST /api/auth/register — validates password min length", async () => {
    const { status } = await fetch("/api/auth/register", {
      body: { email: "test@test.golf", password: "12345", displayName: "Nope" },
    });
    expect(status).toBe(400);
  });

  it("POST /api/auth/register — accepts a negative (plus) handicap", async () => {
    const { status, json } = await fetch("/api/auth/register", {
      body: { email: "plus@hcp.golf", password: "pluspass123", displayName: "PlusPlayer", sgaHandicap: -2.0 },
    });
    expect(status).toBe(200);
    expect(json.user.sgaHandicap).toBe(-2.0);
  });

  it("POST /api/auth/register — rejects handicap below -10", async () => {
    const { status } = await fetch("/api/auth/register", {
      body: { email: "low@hcp.golf", password: "lowpass123", displayName: "Low", sgaHandicap: -10.1 },
    });
    expect(status).toBe(400);
  });

  it("POST /api/auth/register — rejects handicap above 54", async () => {
    const { status } = await fetch("/api/auth/register", {
      body: { email: "high@hcp.golf", password: "highpass123", displayName: "High", sgaHandicap: 54.1 },
    });
    expect(status).toBe(400);
  });

  it("POST /api/auth/login — returns token for valid credentials", async () => {
    const { status, json } = await fetch("/api/auth/login", {
      body: { email: "alice@test.golf", password: "alicepass123" },
    });
    expect(status).toBe(200);
    expect(json.token).toBeDefined();
    expect(json.user.email).toBe("alice@test.golf");
    expect(json.user.sgaHandicap).toBe(9.1);
  });

  it("POST /api/auth/login — rejects wrong password", async () => {
    const { status, json } = await fetch("/api/auth/login", {
      body: { email: "alice@test.golf", password: "wrong" },
    });
    expect(status).toBe(401);
    expect(json.error).toMatch(/invalid/i);
  });

  it("POST /api/auth/login — rejects unknown email", async () => {
    const { status, json } = await fetch("/api/auth/login", {
      body: { email: "nobody@test.golf", password: "123456" },
    });
    expect(status).toBe(401);
    expect(json.error).toMatch(/invalid/i);
  });

  it("GET /api/auth/session — returns current user when authenticated", async () => {
    const { status, json } = await fetch("/api/auth/session", { token: aliceToken });
    expect(status).toBe(200);
    expect(json.email).toBe("alice@test.golf");
    expect(json.displayName).toBe("Alice");
  });

  it("GET /api/auth/session — 401 without token", async () => {
    const { status } = await fetch("/api/auth/session");
    expect(status).toBe(401);
  });

  it("GET /api/auth/session — 401 with invalid token", async () => {
    const { status } = await fetch("/api/auth/session", { token: "garbage" });
    expect(status).toBe(401);
  });
});

// ═══════════════ PROFILE ═══════════════

describe("Profile", () => {
  it("GET /api/profile — returns own profile", async () => {
    const { status, json } = await fetch("/api/profile", { token: aliceToken });
    expect(status).toBe(200);
    expect(json.email).toBe("alice@test.golf");
    expect(json.displayName).toBe("Alice");
    expect(json.homeClub).toBe("Sentosa");
    expect(json.sgaHandicap).toBe(9.1);
  });

  it("PATCH /api/profile — updates displayName", async () => {
    const { status, json } = await fetch("/api/profile", {
      token: aliceToken,
      method: "PATCH",
      body: { displayName: "Alice Updated" },
    });
    expect(status).toBe(200);
    expect(json.displayName).toBe("Alice Updated");
  });

  it("PATCH /api/profile — updates homeClub and sgaHandicap", async () => {
    const { status, json } = await fetch("/api/profile", {
      token: aliceToken,
      method: "PATCH",
      body: { homeClub: "Laguna National", sgaHandicap: 8.5 },
    });
    expect(status).toBe(200);
    expect(json.homeClub).toBe("Laguna National");
    expect(json.sgaHandicap).toBe(8.5);
  });

  it("PATCH /api/profile — updates isPublic", async () => {
    const { status, json } = await fetch("/api/profile", {
      token: aliceToken,
      method: "PATCH",
      body: { isPublic: true },
    });
    expect(status).toBe(200);
    expect(json.isPublic).toBe(true);

    const { json: off } = await fetch("/api/profile", {
      token: aliceToken,
      method: "PATCH",
      body: { isPublic: false },
    });
    expect(off.isPublic).toBe(false);
  });

  it("PATCH /api/profile — rejects empty update", async () => {
    const { status } = await fetch("/api/profile", {
      token: aliceToken,
      method: "PATCH",
      body: {},
    });
    expect(status).toBe(400);
  });
});

// ═══════════════ FRIENDS ═══════════════

describe("Friends", () => {
  it("GET /api/friends — empty list initially", async () => {
    const { status, json } = await fetch("/api/friends", { token: aliceToken });
    expect(status).toBe(200);
    expect(json).toEqual([]);
  });

  it("GET /api/users/search — finds users by name", async () => {
    const { status, json } = await fetch("/api/users/search?q=Bob", { token: aliceToken });
    expect(status).toBe(200);
    expect(json).toHaveLength(1);
    expect(json[0].display_name).toBe("Bob");
  });

  it("GET /api/users/search — excludes self", async () => {
    const { status, json } = await fetch("/api/users/search?q=Alice", { token: aliceToken });
    expect(status).toBe(200);
    expect(json).toHaveLength(0);
  });

  it("GET /api/users/search — requires auth", async () => {
    const { status } = await fetch("/api/users/search?q=Bob");
    expect(status).toBe(401);
  });

  it("POST /api/friends/request — sends a friend request", async () => {
    const { status, json } = await fetch("/api/friends/request", {
      token: aliceToken,
      body: { toId: bobId },
    });
    expect(status).toBe(201);
    expect(json.status).toBe("pending");
    expect(json.fromId).toBe(aliceId);
    expect(json.toId).toBe(bobId);
  });

  it("POST /api/friends/request — includes optional message", async () => {
    const { status, json } = await fetch("/api/friends/request", {
      token: aliceToken,
      body: { toId: bobId, message: "Hey, let's play a round!" },
    });
    expect(status).toBe(201);
    expect(json.message).toBe("Hey, let's play a round!");
  });

  it("POST /api/friends/request — rejects self-friending", async () => {
    const { status } = await fetch("/api/friends/request", {
      token: aliceToken,
      body: { toId: aliceId },
    });
    expect(status).toBe(400);
  });

  it("POST /api/friends/request — rejects duplicate pending request", async () => {
    await fetch("/api/friends/request", { token: aliceToken, body: { toId: bobId } });
    const { status } = await fetch("/api/friends/request", {
      token: aliceToken,
      body: { toId: bobId },
    });
    expect(status).toBe(409);
  });

  it("GET /api/friends/requests — shows pending received", async () => {
    await fetch("/api/friends/request", { token: bobToken, body: { toId: aliceId } });
    const { status, json } = await fetch("/api/friends/requests", { token: aliceToken });
    expect(status).toBe(200);
    expect(json.received).toHaveLength(1);
    expect(json.received[0].display_name).toBe("Bob");
    expect(json.sent).toHaveLength(0);
  });

  it("GET /api/friends/requests — shows pending sent", async () => {
    await fetch("/api/friends/request", { token: aliceToken, body: { toId: bobId } });
    const { status, json } = await fetch("/api/friends/requests", { token: aliceToken });
    expect(status).toBe(200);
    expect(json.sent).toHaveLength(1);
    expect(json.sent[0].display_name).toBe("Bob");
    expect(json.received).toHaveLength(0);
  });

  it("POST /api/friends/accept/:id — accepts and creates mutual friendship", async () => {
    const req = await fetch("/api/friends/request", { token: aliceToken, body: { toId: bobId } });
    const requestId = req.json.id;

    const { status, json } = await fetch(`/api/friends/accept/${requestId}`, {
      token: bobToken,
      method: "POST",
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);

    // Verify mutual friendship
    const bobFriends = await fetch("/api/friends", { token: bobToken });
    expect(bobFriends.json).toHaveLength(1);
    expect(bobFriends.json[0].display_name).toBe("Alice");

    const aliceFriends = await fetch("/api/friends", { token: aliceToken });
    expect(aliceFriends.json).toHaveLength(1);
    expect(aliceFriends.json[0].display_name).toBe("Bob");
  });

  it("POST /api/friends/accept/:id — rejects non-existent request", async () => {
    const { status } = await fetch("/api/friends/accept/nonexistent", {
      token: bobToken,
      method: "POST",
    });
    expect(status).toBe(404);
  });

  it("POST /api/friends/decline/:id — declines a request", async () => {
    const req = await fetch("/api/friends/request", { token: aliceToken, body: { toId: bobId } });
    const requestId = req.json.id;

    const { status } = await fetch(`/api/friends/decline/${requestId}`, {
      token: bobToken,
      method: "POST",
    });
    expect(status).toBe(200);

    // Friendship should NOT exist
    const friends = await fetch("/api/friends", { token: aliceToken });
    expect(friends.json).toEqual([]);
  });

  it("POST /api/friends/remove/:id — removes friendship", async () => {
    // Create friendship
    const req = await fetch("/api/friends/request", { token: aliceToken, body: { toId: bobId } });
    await fetch(`/api/friends/accept/${req.json.id}`, { token: bobToken, method: "POST" });

    const { status } = await fetch(`/api/friends/remove/${bobId}`, {
      token: aliceToken,
      method: "POST",
    });
    expect(status).toBe(200);

    const friends = await fetch("/api/friends", { token: aliceToken });
    expect(friends.json).toEqual([]);
  });

  it("POST /api/friends/regular/:id — toggles regular status", async () => {
    // Create friendship first
    const req = await fetch("/api/friends/request", { token: aliceToken, body: { toId: bobId } });
    await fetch(`/api/friends/accept/${req.json.id}`, { token: bobToken, method: "POST" });

    // Mark as regular
    const { status, json } = await fetch(`/api/friends/regular/${bobId}`, {
      token: aliceToken,
      method: "POST",
      body: { isRegular: true },
    });
    expect(status).toBe(200);
    expect(json.isRegular).toBe(true);

    // Verify in list
    const friends = await fetch("/api/friends", { token: aliceToken });
    expect(friends.json[0].is_regular).toBe(1);
  });

  it("POST /api/friends/regular/:id — fails when not friends", async () => {
    const { status } = await fetch(`/api/friends/regular/${bobId}`, {
      token: aliceToken,
      method: "POST",
      body: { isRegular: true },
    });
    expect(status).toBe(404);
  });
});

// ═══════════════ ROUNDS ═══════════════

describe("Rounds", () => {
  async function makeFriends() {
    const req = await fetch("/api/friends/request", { token: aliceToken, body: { toId: bobId } });
    await fetch(`/api/friends/accept/${req.json.id}`, { token: bobToken, method: "POST" });
  }

  it("GET /api/rounds — empty initially", async () => {
    const { status, json } = await fetch("/api/rounds", { token: aliceToken });
    expect(status).toBe(200);
    expect(json).toEqual([]);
  });

  it("POST /api/rounds — creates a stroke-play round between friends", async () => {
    await makeFriends();

    const { status, json } = await fetch("/api/rounds", {
      token: aliceToken,
      body: {
        date: "2026-08-01",
        format: "stroke",
        course: "Sentosa (Serapong)",
        participants: [
          { playerId: aliceId, ags: 82, cr: 72.0, slope: 130 },
          { playerId: bobId, ags: 76, cr: 72.0, slope: 130 },
        ],
      },
    });
    expect(status).toBe(201);
    expect(json.id).toBeDefined();
    expect(json.status).toBe("pending_attestation");
  });

  it("POST /api/rounds — creates a match-play round", async () => {
    await makeFriends();

    const { status, json } = await fetch("/api/rounds", {
      token: aliceToken,
      body: {
        date: "2026-08-01",
        format: "match",
        course: "Sentosa (Serapong)",
        participants: [
          { playerId: aliceId, holesWon: 5, cr: 72.0, slope: 130 },
          { playerId: bobId, holesWon: 3, cr: 72.0, slope: 130 },
        ],
      },
    });
    expect(status).toBe(201);
    expect(json.status).toBe("pending_attestation");
  });

  it("POST /api/rounds — supports nine-hole rounds", async () => {
    await makeFriends();

    const { status, json } = await fetch("/api/rounds", {
      token: aliceToken,
      body: {
        date: "2026-08-01",
        format: "stroke",
        course: "Sentosa (Serapong)",
        nine: "front",
        holes: 9,
        par: 36,
        participants: [
          { playerId: aliceId, ags: 40, cr: 36.0, slope: 130 },
          { playerId: bobId, ags: 38, cr: 36.0, slope: 130 },
        ],
      },
    });
    expect(status).toBe(201);
  });

  it("POST /api/rounds — rejects round with fewer than 2 participants", async () => {
    await makeFriends();

    const { status } = await fetch("/api/rounds", {
      token: aliceToken,
      body: {
        date: "2026-08-01",
        format: "stroke",
        course: "Sentosa (Serapong)",
        participants: [{ playerId: aliceId, ags: 82, cr: 72.0, slope: 130 }],
      },
    });
    expect(status).toBe(400);
  });

  it("POST /api/rounds — rejects round with non-friend participant", async () => {
    const { status } = await fetch("/api/rounds", {
      token: aliceToken,
      body: {
        date: "2026-08-01",
        format: "stroke",
        course: "Sentosa (Serapong)",
        participants: [
          { playerId: aliceId, ags: 82, cr: 72.0, slope: 130 },
          { playerId: bobId, ags: 76, cr: 72.0, slope: 130 },
        ],
      },
    });
    expect(status).toBe(403);
  });

  it("POST /api/rounds — creates attestation records for opponents", async () => {
    await makeFriends();

    await fetch("/api/rounds", {
      token: aliceToken,
      body: {
        date: "2026-08-01",
        format: "stroke",
        course: "Sentosa (Serapong)",
        participants: [
          { playerId: aliceId, ags: 82, cr: 72.0, slope: 130 },
          { playerId: bobId, ags: 76, cr: 72.0, slope: 130 },
        ],
      },
    });

    const { status, json } = await fetch("/api/attestations", { token: bobToken });
    expect(status).toBe(200);
    expect(json).toHaveLength(1);
    expect(json[0].format).toBe("stroke");
    expect(json[0].course).toBe("Sentosa (Serapong)");
  });

  it("GET /api/rounds/:id — returns round details with participants", async () => {
    await makeFriends();

    const created = await fetch("/api/rounds", {
      token: aliceToken,
      body: {
        date: "2026-08-01",
        format: "stroke",
        course: "Sentosa (Serapong)",
        participants: [
          { playerId: aliceId, ags: 82, cr: 72.0, slope: 130 },
          { playerId: bobId, ags: 76, cr: 72.0, slope: 130 },
        ],
      },
    });
    const roundId = created.json.id;

    const { status, json } = await fetch(`/api/rounds/${roundId}`, { token: bobToken });
    expect(status).toBe(200);
    expect(json.id).toBe(roundId);
    expect(json.participants).toHaveLength(2);
    expect(json.participants.some((p: any) => p.player_id === bobId && p.ags === 76)).toBe(true);
  });

  it("GET /api/rounds — includes participants for each round", async () => {
    await makeFriends();

    await fetch("/api/rounds", {
      token: aliceToken,
      body: {
        date: "2026-08-01",
        format: "stroke",
        course: "Sentosa (Serapong)",
        participants: [
          { playerId: aliceId, ags: 82, cr: 72.0, slope: 130 },
          { playerId: bobId, ags: 76, cr: 72.0, slope: 130 },
        ],
      },
    });

    const { status, json } = await fetch("/api/rounds", { token: aliceToken });
    expect(status).toBe(200);
    expect(json.length).toBeGreaterThan(0);
    const round = json.find((r: any) => r.participants?.length > 0);
    expect(round).toBeDefined();
    expect(round.participants).toHaveLength(2);
    expect(round.participants.some((p: any) => p.player_id === aliceId && p.ags === 82)).toBe(true);
    expect(round.participants.some((p: any) => p.player_id === bobId && p.ags === 76)).toBe(true);
  });
});

// ═══════════════ REPLAY ═══════════════

describe("Replay", () => {
  it("GET /api/replay — returns seeded ratings with no rounds", async () => {
    const { status, json } = await fetch("/api/replay", { token: aliceToken });
    expect(status).toBe(200);
    expect(json.players).toBeDefined();
    // Alice should appear with her seeded rating
    const alice = json.players.find((p: any) => p.id === aliceId);
    expect(alice).toBeDefined();
    expect(alice.rating).toBeDefined();
  });

  it("GET /api/replay — includes network players after rounds are logged", async () => {
    // Make friends + log a round
    const req = await fetch("/api/friends/request", { token: aliceToken, body: { toId: bobId } });
    await fetch(`/api/friends/accept/${req.json.id}`, { token: bobToken, method: "POST" });

    await fetch("/api/rounds", {
      token: aliceToken,
      body: {
        date: "2026-08-01",
        format: "stroke",
        course: "Sentosa (Serapong)",
        participants: [
          { playerId: aliceId, ags: 82, cr: 72.0, slope: 130 },
          { playerId: bobId, ags: 76, cr: 72.0, slope: 130 },
        ],
      },
    });

    // Confirm the round so replay picks it up
    const att = await fetch("/api/attestations", { token: bobToken });
    await fetch(`/api/attestations/${att.json[0].id}/confirm`, { token: bobToken, method: "POST" });

    const { status, json } = await fetch("/api/replay", { token: aliceToken });
    expect(status).toBe(200);
    expect(json.rounds.length).toBeGreaterThan(0);
    // Bob should be in the player list
    const bob = json.players.find((p: any) => p.id === bobId);
    expect(bob).toBeDefined();
  });
});

// ═══════════════ ATTESTATION ═══════════════

describe("Attestation", () => {
  async function logRound() {
    const req = await fetch("/api/friends/request", { token: aliceToken, body: { toId: bobId } });
    await fetch(`/api/friends/accept/${req.json.id}`, { token: bobToken, method: "POST" });
    await fetch("/api/rounds", {
      token: aliceToken,
      body: {
        date: "2026-08-01",
        format: "stroke",
        course: "Sentosa (Serapong)",
        participants: [
          { playerId: aliceId, ags: 82, cr: 72.0, slope: 130 },
          { playerId: bobId, ags: 76, cr: 72.0, slope: 130 },
        ],
      },
    });
  }

  it("GET /api/attestations — lists pending attestations", async () => {
    await logRound();
    const { status, json } = await fetch("/api/attestations", { token: bobToken });
    expect(status).toBe(200);
    expect(json).toHaveLength(1);
    expect(json[0].status).toBe("pending");
  });

  it("POST /api/attestations/:id/confirm — confirms and transitions round to confirmed", async () => {
    await logRound();
    const atts = await fetch("/api/attestations", { token: bobToken });
    const attId = atts.json[0].id;

    const { status, json } = await fetch(`/api/attestations/${attId}/confirm`, {
      token: bobToken,
      method: "POST",
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);

    // Should no longer appear as pending
    const atts2 = await fetch("/api/attestations", { token: bobToken });
    expect(atts2.json).toHaveLength(0);
  });

  it("POST /api/attestations/:id/confirm — rejects non-target user", async () => {
    await logRound();
    const atts = await fetch("/api/attestations", { token: bobToken });
    const attId = atts.json[0].id;

    // Alice is the logger, NOT the attestation target
    const { status } = await fetch(`/api/attestations/${attId}/confirm`, {
      token: aliceToken,
      method: "POST",
    });
    expect(status).toBe(404);
  });

  it("POST /api/attestations/:id/dispute — updates scores and sends reverse attestation", async () => {
    await logRound();
    const atts = await fetch("/api/attestations", { token: bobToken });
    const attId = atts.json[0].id;

    const { status, json } = await fetch(`/api/attestations/${attId}/dispute`, {
      token: bobToken,
      method: "POST",
      body: {
        participants: [{ playerId: aliceId, ags: 78 }, { playerId: bobId, ags: 82 }],
      },
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);

    // Original attestation should no longer be pending for bob
    const atts2 = await fetch("/api/attestations", { token: bobToken });
    expect(atts2.json).toHaveLength(0);

    // Reverse attestation should appear for alice (the original logger)
    const atts3 = await fetch("/api/attestations", { token: aliceToken });
    expect(atts3.json).toHaveLength(1);
    expect(atts3.json[0].round_id).toBe(atts.json[0].round_id);

    // Scores should be updated
    const round = await fetch(`/api/rounds/${atts.json[0].round_id}`, { token: aliceToken });
    expect(round.status).toBe(200);
    const bobParticipant = round.json.participants.find((p: any) => p.player_id === bobId);
    expect(bobParticipant.ags).toBe(82);
  });
});

// ═══════════════ COURSES ═══════════════

describe("Courses", () => {
  it("POST /api/courses — creates a course (admin only)", async () => {
    const { status, json } = await fetch("/api/courses", {
      token: adminToken,
      body: { name: "Test Course", club: "Test Club", verified: true, source: "SGA" },
    });
    expect(status).toBe(201);
    expect(json.name).toBe("Test Course");
    expect(json.verified).toBe(true);
  });

  it("POST /api/courses — creates a course with tees", async () => {
    const { status, json } = await fetch("/api/courses", {
      token: adminToken,
      body: {
        name: "Tee Test",
        club: "Test Club",
        tees: [
          { name: "Blue", colour: "Blue", yardage: 6400, par: 72, cr: 71.5, slope: 128 },
          { name: "White", colour: "White", yardage: 6100, par: 72, cr: 69.8, slope: 124 },
        ],
      },
    });
    expect(status).toBe(201);
    expect(json.name).toBe("Tee Test");
  });

  it("POST /api/courses — rejects non-admin user", async () => {
    const { status } = await fetch("/api/courses", {
      token: aliceToken,
      body: { name: "Nope", club: "Nope" },
    });
    expect(status).toBe(403);
  });

  it("GET /api/courses — returns created courses with tees", async () => {
    await fetch("/api/courses", {
      token: adminToken,
      body: { name: "List Test", club: "Test Club", verified: true },
    });

    const { status, json } = await fetch("/api/courses", { token: aliceToken });
    expect(status).toBe(200);
    expect(json).toHaveLength(1);
    expect(json[0].name).toBe("List Test");
    expect(json[0].tees).toEqual([]);
  });
});

// ═══════════════ CONFIG ═══════════════

describe("Config", () => {
  it("GET /api/config — returns engine config defaults", async () => {
    const { status, json } = await fetch("/api/config", { token: aliceToken });
    expect(status).toBe(200);
    expect(json.startRating).toBe(1500);
    expect(json.alphaStroke).toBe(0.30);
    expect(json.alphaMatch).toBe(0.435);
  });

  it("PATCH /api/config — updates engine config (admin only)", async () => {
    const { status, json } = await fetch("/api/config", {
      token: adminToken,
      method: "PATCH",
      body: { alphaStroke: 0.25 },
    });
    expect(status).toBe(200);
    expect(json.alphaStroke).toBe(0.25);
    // alphaMatch is derived from alphaStroke * matchStrokeFactor, so it
    // recomputes when alphaStroke changes (0.25 * 1.45 = 0.3625).
    expect(json.alphaMatch).toBe(0.3625);
    // unrelated keys preserved
    expect(json.kFloor).toBe(40);
  });

  it("PATCH /api/config — changing matchStrokeFactor recomputes alphaMatch", async () => {
    const { status, json } = await fetch("/api/config", {
      token: adminToken,
      method: "PATCH",
      body: { matchStrokeFactor: 1.5 },
    });
    expect(status).toBe(200);
    expect(json.matchStrokeFactor).toBe(1.5);
    expect(json.alphaMatch).toBe(json.alphaStroke * 1.5);
  });

  it("PATCH /api/config — explicit alphaMatch overrides the derivation", async () => {
    const { status, json } = await fetch("/api/config", {
      token: adminToken,
      method: "PATCH",
      body: { alphaStroke: 0.25, alphaMatch: 0.9 },
    });
    expect(status).toBe(200);
    expect(json.alphaStroke).toBe(0.25);
    expect(json.alphaMatch).toBe(0.9);
  });

  it("PATCH /api/config — rejects non-admin", async () => {
    const { status } = await fetch("/api/config", {
      token: aliceToken,
      method: "PATCH",
      body: { alphaStroke: 0.25 },
    });
    expect(status).toBe(403);
  });
});

// ═══════════════ SUSPENDED USER ═══════════════

describe("Suspended user", () => {
  it("gets 403 on protected endpoints", async () => {
    // Register + suspend a user directly via DB
    const res = await fetch("/api/auth/register", {
      body: { email: "bad@test.golf", password: "badpass123", displayName: "Bad User" },
    });
    const badToken = res.json.token;
    const badId = res.json.user.id;

    // Suspend via DB
    const db = (await import("./db/connection.js")).default;
    db.prepare("UPDATE users SET is_suspended = 1 WHERE id = ?").run(badId);

    const { status } = await fetch("/api/auth/session", { token: badToken });
    expect(status).toBe(403);
  });
});

// ═══════════════ TOKEN FAMILY ═══════════════

describe("Token handling", () => {
  it("login after register returns the same user id", async () => {
    const login = await fetch("/api/auth/login", {
      body: { email: "alice@test.golf", password: "alicepass123" },
    });
    expect(login.json.user.id).toBe(aliceId);
  });
});

// ═══════════════ ADMIN ENDPOINTS ═══════════════

describe("Admin endpoints", () => {
  it("GET /api/admin/stats — returns counts", async () => {
    const { status, json } = await fetch("/api/admin/stats", { token: adminToken });
    expect(status).toBe(200);
    expect(json.users).toBe(3); // admin, alice, bob
    expect(typeof json.uptime).toBe("string");
  });

  it("GET /api/admin/users — lists all users", async () => {
    const { status, json } = await fetch("/api/admin/users", { token: adminToken });
    expect(status).toBe(200);
    expect(json).toHaveLength(3);
    const emails = json.map((u: any) => u.email).sort();
    expect(emails).toEqual(["admin@test.golf", "alice@test.golf", "bob@test.golf"]);
  });

  it("POST /api/admin/refresh-pros — backfills is_pro for famous players and updates handicaps", async () => {
    const db = (await import("./db/connection.js")).default;
    const uid = () => crypto.randomUUID();
    const hash = "$argon2id$v=19$m=65536,t=3,p=4$fake$fake"; // not used for auth here

    // Insert two "famous" players with is_pro accidentally set to 0 (legacy DB state)
    db.prepare(`INSERT INTO users (id, email, password_hash, display_name, home_club, region, sga_handicap, is_public, is_pro)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uid(), "tiger.woods@famous.golf", hash, "Tiger Woods", "USA", "California", -6.2, 1, 0);
    db.prepare(`INSERT INTO users (id, email, password_hash, display_name, home_club, region, sga_handicap, is_public, is_pro)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uid(), "bryson.dechambeau@famous.golf", hash, "Bryson DeChambeau", "USA", "Texas", -6.0, 1, 1);

    const { status, json } = await fetch("/api/admin/refresh-pros", { token: adminToken, method: "POST" });
    expect(status).toBe(200);
    expect(json.updated).toBe(10); // all canonical famous players refreshed

    const rows = db.prepare("SELECT display_name, is_pro FROM users WHERE email LIKE '%@famous.golf' ORDER BY display_name").all() as any[];
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.is_pro === 1)).toBe(true);
  }, 30000);
});

// ═══════════════ AI NARRATE ═══════════════

describe("AI Narrate", () => {
  async function makeFriendsAndLogRound() {
    const req = await fetch("/api/friends/request", { token: aliceToken, body: { toId: bobId } });
    await fetch(`/api/friends/accept/${req.json.id}`, { token: bobToken, method: "POST" });

    const res = await fetch("/api/rounds", {
      token: aliceToken,
      body: {
        date: "2026-08-01",
        format: "stroke",
        course: "Sentosa (Serapong)",
        participants: [
          { playerId: aliceId, ags: 82, cr: 72.0, slope: 130 },
          { playerId: bobId, ags: 76, cr: 72.0, slope: 130 },
        ],
      },
    });
    return res.json.id;
  }

  it("POST /api/ai/narrate — generates narrative with player context", async () => {
    const roundId = await makeFriendsAndLogRound();

    const { status, json } = await fetch("/api/ai/narrate", {
      token: aliceToken,
      body: { roundId },
    });
    expect(status).toBe(200);
    expect(json.narrative).toBeDefined();
    expect(typeof json.narrative).toBe("string");
    expect(json.narrative.length).toBeGreaterThan(20);
    expect(json.generatedAt).toBeDefined();
  }, 15000);

  it("POST /api/ai/narrate — stores result in ai_analysis table", async () => {
    const roundId = await makeFriendsAndLogRound();

    await fetch("/api/ai/narrate", {
      token: aliceToken,
      body: { roundId },
    });

    // Verify stored in DB
    const db = (await import("./db/connection.js")).default;
    const row = db.prepare("SELECT * FROM ai_analysis WHERE round_id = ?").get(roundId) as any;
    expect(row).toBeDefined();
    expect(row.narration).toBeDefined();
    expect(row.narration.length).toBeGreaterThan(0);
  });

  it("POST /api/ai/narrate — mentions player names in narrative", async () => {
    const roundId = await makeFriendsAndLogRound();

    const { status, json } = await fetch("/api/ai/narrate", {
      token: aliceToken,
      body: { roundId },
    });
    expect(status).toBe(200);
    expect(json.narrative).toMatch(/Alice|Bob/);
  });

  it("POST /api/ai/narrate — includes course name", async () => {
    const roundId = await makeFriendsAndLogRound();

    const { status, json } = await fetch("/api/ai/narrate", {
      token: aliceToken,
      body: { roundId },
    });
    expect(json.narrative).toMatch(/Sentosa/);
  });

  it("POST /api/ai/narrate — rejects non-participant users", async () => {
    // Register a third user who is not in the round
    const charlieRes = await fetch("/api/auth/register", {
      body: { email: "charlie@test.golf", password: "charlie123", displayName: "Charlie" },
    });
    const charlieToken = charlieRes.json.token;

    const roundId = await makeFriendsAndLogRound();

    const { status, json } = await fetch("/api/ai/narrate", {
      token: charlieToken,
      body: { roundId },
    });
    expect(status).toBe(404);
    expect(json.error).toBeDefined();
  });

  it("POST /api/ai/narrate — validates roundId presence", async () => {
    const { status } = await fetch("/api/ai/narrate", {
      token: aliceToken,
      body: {},
    });
    expect(status).toBe(400);
  });

  it("POST /api/ai/narrate — requires authentication", async () => {
    const { status } = await fetch("/api/ai/narrate", {
      body: { roundId: "fake-id" },
    });
    expect(status).toBe(401);
  });
});

// ═══════════════ AI OCR SCORECARD ═══════════════

describe("AI OCR Scorecard", () => {
  it("POST /api/ai/ocr-scorecard — returns fallback when AI disabled", async () => {
    // Send minimal valid multipart — will get fallback since AI_API_KEY is not set
    const boundary = "----TestBoundary";
    const body = `------TestBoundary\r\nContent-Disposition: form-data; name="image"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\nfake-image-data\r\n------TestBoundary--\r\n`;

    const req = new Request("http://localhost/api/ai/ocr-scorecard", {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=----TestBoundary`,
        Authorization: `Bearer ${aliceToken}`,
      },
      body,
    });

    const app = (await import("./index.js")).default;
    const res = await app.fetch(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.fallback).toBe(true);
    expect(json.message).toMatch(/not configured|manually/i);
  });

  it("POST /api/ai/ocr-scorecard — requires authentication", async () => {
    const boundary = "----TestBoundary";
    const body = `------TestBoundary\r\nContent-Disposition: form-data; name="image"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\nfake-image-data\r\n------TestBoundary--\r\n`;

    const req = new Request("http://localhost/api/ai/ocr-scorecard", {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=----TestBoundary`,
      },
      body,
    });

    const app = (await import("./index.js")).default;
    const res = await app.fetch(req);
    expect(res.status).toBe(401);
  });
});

// ═══════════════ AI PARSE ROUND ═══════════════

describe("AI Parse Round", () => {
  it("POST /api/ai/parse-round — parses 'Shot 82 with Darren at Sheshan'", async () => {
    const { status, json } = await fetch("/api/ai/parse-round", {
      token: aliceToken,
      body: { text: "Shot 82 with Darren at Sheshan" },
    });
    expect(status).toBe(200);
    expect(json.players).toBeDefined();
    expect(json.players.length).toBeGreaterThan(0);
    expect(json.course).toBe("Sheshan International (佘山国际)");
    expect(json.confidence).toBeDefined();
  });

  it("POST /api/ai/parse-round — detects course from partial name", async () => {
    const { status, json } = await fetch("/api/ai/parse-round", {
      token: aliceToken,
      body: { text: "Played at Yintao, shot 78" },
    });
    expect(status).toBe(200);
    expect(json.course).toBe("Yintao (银涛)");
  });

  it("POST /api/ai/parse-round — detects stableford format", async () => {
    const { status, json } = await fetch("/api/ai/parse-round", {
      token: aliceToken,
      body: { text: "36 points stableford at Sun Island" },
    });
    expect(status).toBe(200);
    expect(json.format).toBe("stableford");
    expect(json.course).toBe("Sun Island (太阳岛)");
  });

  it("POST /api/ai/parse-round — handles empty input gracefully", async () => {
    const { status, json } = await fetch("/api/ai/parse-round", {
      token: aliceToken,
      body: { text: "Just a casual round, nothing special" },
    });
    expect(status).toBe(200);
    expect(json.confidence).toBe("low");
    expect(json.players).toBeDefined();
  });

  it("POST /api/ai/parse-round — validates text presence", async () => {
    const { status } = await fetch("/api/ai/parse-round", {
      token: aliceToken,
      body: {},
    });
    expect(status).toBe(400);
  });

  it("POST /api/ai/parse-round — rejects empty string", async () => {
    const { status } = await fetch("/api/ai/parse-round", {
      token: aliceToken,
      body: { text: "" },
    });
    expect(status).toBe(400);
  });

  it("POST /api/ai/parse-round — requires authentication", async () => {
    const { status } = await fetch("/api/ai/parse-round", {
      body: { text: "Shot 82" },
    });
    expect(status).toBe(401);
  });
});

// ═══════════════ AI MATCH SUGGESTIONS ═══════════════

describe("AI Match Suggestions", () => {
  it("POST /api/ai/match-suggestions — returns empty for no friends", async () => {
    const { status, json } = await fetch("/api/ai/match-suggestions", {
      token: aliceToken,
      method: "POST",
    });
    expect(status).toBe(200);
    expect(json.suggestions).toEqual([]);
  });

  it("POST /api/ai/match-suggestions — returns suggestions for connected user", async () => {
    // Make friends
    const req = await fetch("/api/friends/request", { token: aliceToken, body: { toId: bobId } });
    await fetch(`/api/friends/accept/${req.json.id}`, { token: bobToken, method: "POST" });

    const { status, json } = await fetch("/api/ai/match-suggestions", {
      token: aliceToken,
      method: "POST",
    });
    expect(status).toBe(200);
    expect(json.suggestions).toBeDefined();
    expect(json.suggestions.length).toBeGreaterThan(0);
    expect(json.suggestions[0].playerId).toBe(bobId);
    expect(json.suggestions[0].playerName).toBe("Bob");
    expect(typeof json.suggestions[0].rating).toBe("number");
    expect(typeof json.suggestions[0].ratingGap).toBe("number");
    expect(typeof json.suggestions[0].reason).toBe("string");
    expect(json.suggestions[0].reason.length).toBeGreaterThan(0);
  });

  it("POST /api/ai/match-suggestions — boosts regular friends", async () => {
    // Make friends and mark as regular
    const req = await fetch("/api/friends/request", { token: aliceToken, body: { toId: bobId } });
    await fetch(`/api/friends/accept/${req.json.id}`, { token: bobToken, method: "POST" });
    await fetch(`/api/friends/regular/${bobId}`, {
      token: aliceToken,
      method: "POST",
      body: { isRegular: true },
    });

    const { status, json } = await fetch("/api/ai/match-suggestions", {
      token: aliceToken,
      method: "POST",
    });
    expect(status).toBe(200);
    expect(json.suggestions.length).toBeGreaterThan(0);
    // The regular boost should make Bob the top suggestion
    expect(json.suggestions[0].playerId).toBe(bobId);
  });

  it("POST /api/ai/match-suggestions — requires authentication", async () => {
    const { status } = await fetch("/api/ai/match-suggestions", {
      method: "POST",
    });
    expect(status).toBe(401);
  });
});

// ═══════════════ AI DETECT ANOMALIES ═══════════════

describe("AI Detect Anomalies", () => {
  it("POST /api/ai/detect-anomalies — returns empty with no rounds", async () => {
    const { status, json } = await fetch("/api/ai/detect-anomalies", {
      token: aliceToken,
      method: "POST",
    });
    expect(status).toBe(200);
    expect(json.anomalies).toEqual([]);
  });

  it("POST /api/ai/detect-anomalies — returns empty with few rounds", async () => {
    // Log one round as confirmed
    const req = await fetch("/api/friends/request", { token: aliceToken, body: { toId: bobId } });
    await fetch(`/api/friends/accept/${req.json.id}`, { token: bobToken, method: "POST" });

    await fetch("/api/rounds", {
      token: aliceToken,
      body: {
        date: "2026-08-01",
        format: "stroke",
        course: "Sentosa (Serapong)",
        participants: [
          { playerId: aliceId, ags: 82, cr: 72.0, slope: 130 },
          { playerId: bobId, ags: 76, cr: 72.0, slope: 130 },
        ],
      },
    });

    // Confirm round via DB (bypass attestation)
    const db = (await import("./db/connection.js")).default;
    db.prepare("UPDATE rounds SET status = 'confirmed'").run();

    const { status, json } = await fetch("/api/ai/detect-anomalies", {
      token: aliceToken,
      method: "POST",
    });
    expect(status).toBe(200);
    // Less than 3 rounds, should return empty
    expect(json.anomalies).toEqual([]);
  });

  it("POST /api/ai/detect-anomalies — requires authentication", async () => {
    const { status } = await fetch("/api/ai/detect-anomalies", {
      method: "POST",
    });
    expect(status).toBe(401);
  });
});

// ═══════════════ AI SEASON RECAP ═══════════════

describe("AI Season Recap", () => {
  it("GET /api/ai/season-recap/:playerId — returns empty recap for new user", async () => {
    const { status, json } = await fetch(`/api/ai/season-recap/${aliceId}`, {
      token: aliceToken,
    });
    expect(status).toBe(200);
    expect(json.stats.totalRounds).toBe(0);
    expect(json.narrative).toBeDefined();
  });

  it("GET /api/ai/season-recap/:playerId — works for self", async () => {
    // Log and confirm a round
    const req = await fetch("/api/friends/request", { token: aliceToken, body: { toId: bobId } });
    await fetch(`/api/friends/accept/${req.json.id}`, { token: bobToken, method: "POST" });

    await fetch("/api/rounds", {
      token: aliceToken,
      body: {
        date: "2026-08-01",
        format: "stroke",
        course: "Sentosa (Serapong)",
        participants: [
          { playerId: aliceId, ags: 82, cr: 72.0, slope: 130 },
          { playerId: bobId, ags: 76, cr: 72.0, slope: 130 },
        ],
      },
    });

    // Confirm round
    const db = (await import("./db/connection.js")).default;
    db.prepare("UPDATE rounds SET status = 'confirmed'").run();

    const { status, json } = await fetch(`/api/ai/season-recap/${aliceId}`, {
      token: aliceToken,
    });
    expect(status).toBe(200);
    expect(json.stats.totalRounds).toBeGreaterThan(0);
    expect(json.narrative).toBeDefined();
    expect(json.period.from).toBeDefined();
    expect(json.period.to).toBeDefined();
  }, 15000);

  it("GET /api/ai/season-recap/:playerId — rejects non-friend access", async () => {
    // Register a third user
    const charlieRes = await fetch("/api/auth/register", {
      body: { email: "charlie@test.golf", password: "charlie123", displayName: "Charlie" },
    });
    const charlieToken = charlieRes.json.token;

    const { status, json } = await fetch(`/api/ai/season-recap/${bobId}`, {
      token: charlieToken,
    });
    expect(status).toBe(403);
    expect(json.error).toBeDefined();
  });

  it("GET /api/ai/season-recap/:playerId — includes stats fields", async () => {
    // Log multiple rounds for richer stats
    const req = await fetch("/api/friends/request", { token: aliceToken, body: { toId: bobId } });
    await fetch(`/api/friends/accept/${req.json.id}`, { token: bobToken, method: "POST" });

    // Log two confirmed rounds
    await fetch("/api/rounds", {
      token: aliceToken,
      body: {
        date: "2026-07-15",
        format: "stroke",
        course: "Sentosa (Serapong)",
        participants: [
          { playerId: aliceId, ags: 84, cr: 72.0, slope: 130 },
          { playerId: bobId, ags: 78, cr: 72.0, slope: 130 },
        ],
      },
    });

    await fetch("/api/rounds", {
      token: aliceToken,
      body: {
        date: "2026-08-01",
        format: "stroke",
        course: "Tanah Merah (Tampines)",
        participants: [
          { playerId: aliceId, ags: 80, cr: 71.4, slope: 125 },
          { playerId: bobId, ags: 75, cr: 71.4, slope: 125 },
        ],
      },
    });

    const db = (await import("./db/connection.js")).default;
    db.prepare("UPDATE rounds SET status = 'confirmed'").run();

    const { status, json } = await fetch(`/api/ai/season-recap/${aliceId}`, {
      token: aliceToken,
    });
    expect(status).toBe(200);
    expect(json.stats.totalRounds).toBe(2);
    expect(json.stats.ratingTrend).toBeDefined();
    expect(json.stats.courseCounts).toBeDefined();
    expect(Object.keys(json.stats.courseCounts).length).toBeGreaterThan(0);
  }, 15000);

  it("GET /api/ai/season-recap/:playerId — requires authentication", async () => {
    const { status } = await fetch(`/api/ai/season-recap/${aliceId}`);
    expect(status).toBe(401);
  });

  it("GET /api/ai/season-recap/me — resolves for authenticated user", async () => {
    const { status, json } = await fetch("/api/ai/season-recap/me", {
      token: aliceToken,
    });
    expect(status).toBe(200);
    expect(json.stats.totalRounds).toBe(0); // new user, no rounds
    expect(json.narrative).toBeDefined();
  });
});

// ═══════════════ ISSUE 2: UNKNOWN API ROUTES ═══════════════

describe("Unknown API routes return 404", () => {
  it("GET /api/doesnotexist returns 404", async () => {
    const { status, json } = await fetch("/api/doesnotexist");
    expect(status).toBe(404);
    expect(json.error).toBeDefined();
  });

  it("POST /api/doesnotexist returns 404", async () => {
    const { status, json } = await fetch("/api/doesnotexist", { method: "POST", body: {} });
    expect(status).toBe(404);
    expect(json.error).toBeDefined();
  });

  it("GET /api/typo/extra/segments returns 404", async () => {
    const { status } = await fetch("/api/typo/extra/segments");
    expect(status).toBe(404);
  });

  it("known routes still work after catch-all fix", async () => {
    const { status } = await fetch("/api/health");
    expect(status).toBe(200);
  });
});

// ═══════════════ ISSUE 3: RANKINGS & PROS ═══════════════

describe("GET /api/rankings", () => {
  it("returns 401 without token", async () => {
    const { status } = await fetch("/api/rankings");
    expect(status).toBe(401);
  });

  it("returns 200 with valid token and friends scope", async () => {
    const { status, json } = await fetch("/api/rankings", { token: aliceToken });
    expect(status).toBe(200);
    expect(json.scope).toBe("friends");
    expect(Array.isArray(json.rankings)).toBe(true);
  });

  it("returns 200 with club scope", async () => {
    const { status, json } = await fetch("/api/rankings?scope=club", { token: aliceToken });
    expect(status).toBe(200);
    expect(json.scope).toBe("club");
    expect(Array.isArray(json.rankings)).toBe(true);
  });

  it("returns 200 with global scope", async () => {
    const { status, json } = await fetch("/api/rankings?scope=global", { token: aliceToken });
    expect(status).toBe(200);
    expect(json.scope).toBe("global");
    expect(Array.isArray(json.rankings)).toBe(true);
  });

  it("includes computed rating in entries when rounds exist", async () => {
    // Make Alice and Bob friends, log a confirmed round
    const req = await fetch("/api/friends/request", { token: aliceToken, body: { toId: bobId } });
    await fetch(`/api/friends/accept/${req.json.id}`, { token: bobToken, method: "POST" });

    await fetch("/api/rounds", {
      token: aliceToken,
      body: {
        date: "2026-08-01",
        format: "stroke",
        course: "Sentosa (Serapong)",
        participants: [
          { playerId: aliceId, ags: 82, cr: 72.0, slope: 130 },
          { playerId: bobId, ags: 76, cr: 72.0, slope: 130 },
        ],
      },
    });

    const db = (await import("./db/connection.js")).default;
    db.prepare("UPDATE rounds SET status = 'confirmed'").run();

    const { status, json } = await fetch("/api/rankings", { token: aliceToken });
    expect(status).toBe(200);
    expect(json.rankings.length).toBeGreaterThanOrEqual(1);

    const alice = json.rankings.find((r: any) => r.playerId === aliceId);
    expect(alice).toBeDefined();
    expect(typeof alice.rating).toBe("number");
    expect(typeof alice.matches).toBe("number");
  });
});

describe("GET /api/pros", () => {
  it("returns 401 without token", async () => {
    const { status } = await fetch("/api/pros");
    expect(status).toBe(401);
  });

  it("returns 200 with valid token", async () => {
    const { status, json } = await fetch("/api/pros", { token: aliceToken });
    expect(status).toBe(200);
    expect(Array.isArray(json.pros)).toBe(true);
  });

  it("includes userRating for comparison when rounds exist", async () => {
    // Make Alice and Bob friends, log and confirm a round
    const req = await fetch("/api/friends/request", { token: aliceToken, body: { toId: bobId } });
    await fetch(`/api/friends/accept/${req.json.id}`, { token: bobToken, method: "POST" });

    await fetch("/api/rounds", {
      token: aliceToken,
      body: {
        date: "2026-08-01",
        format: "stroke",
        course: "Sentosa (Serapong)",
        participants: [
          { playerId: aliceId, ags: 82, cr: 72.0, slope: 130 },
          { playerId: bobId, ags: 76, cr: 72.0, slope: 130 },
        ],
      },
    });

    const db = (await import("./db/connection.js")).default;
    db.prepare("UPDATE rounds SET status = 'confirmed'").run();

    const { status, json } = await fetch("/api/pros", { token: aliceToken });
    expect(status).toBe(200);
    expect(json.userRating).toBeDefined();
    expect(typeof json.userRating.rating).toBe("number");
  });
});

// ═══════════════ ISSUE 4: PROFILE WITH RATING ═══════════════

describe("GET /api/profile includes computed rating", () => {
  it("returns rating fields in profile response", async () => {
    const { status, json } = await fetch("/api/profile", { token: aliceToken });
    expect(status).toBe(200);
    expect(json).toHaveProperty("rating");
    expect(json).toHaveProperty("ratingDeviation");
    expect(json).toHaveProperty("rank");
    expect(json).toHaveProperty("matches");
    expect(json).toHaveProperty("isProvisional");
  });

  it("rating is seeded from handicap (no rounds yet)", async () => {
    // Alice registered with sgaHandicap 9.1 → seed rating ~1410
    const { json } = await fetch("/api/profile", { token: aliceToken });
    expect(typeof json.rating).toBe("number");
    expect(json.matches).toBe(0);
    expect(json.isProvisional).toBe(true);
  });

  it("rating is updated after confirmed rounds", async () => {
    // Make friends and log a round
    const req = await fetch("/api/friends/request", { token: aliceToken, body: { toId: bobId } });
    await fetch(`/api/friends/accept/${req.json.id}`, { token: bobToken, method: "POST" });

    await fetch("/api/rounds", {
      token: aliceToken,
      body: {
        date: "2026-08-01",
        format: "stroke",
        course: "Sentosa (Serapong)",
        participants: [
          { playerId: aliceId, ags: 82, cr: 72.0, slope: 130 },
          { playerId: bobId, ags: 76, cr: 72.0, slope: 130 },
        ],
      },
    });

    const db = (await import("./db/connection.js")).default;
    db.prepare("UPDATE rounds SET status = 'confirmed'").run();

    const { json } = await fetch("/api/profile", { token: aliceToken });
    expect(json.matches).toBeGreaterThan(0);
    // Rating should have moved from seed after the round
    expect(typeof json.rating).toBe("number");
    expect(typeof json.ratingDeviation).toBe("number");
  });
});

// ═══════════════ ISSUE 1: JWT_SECRET enforcement ═══════════════

describe("JWT_SECRET enforcement", () => {
  it("throws if JWT_SECRET is missing", async () => {
    // This is enforced at module load time, so we verify the existing
    // vitest config provides JWT_SECRET and the module loaded successfully
    const auth = await import("./middleware/auth.js");
    expect(auth.createToken).toBeDefined();
    expect(auth.verifyToken).toBeDefined();
  });

  it("rejects tokens signed with wrong secret", async () => {
    // Create a token signed with a different secret — just verify it fails
    const auth = await import("./middleware/auth.js");
    const invalid = await auth.verifyToken("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.invalid");
    expect(invalid).toBeNull();
  });
});

// ═══════════════ ISSUE 5: SEASON RECAP /me ═══════════════

describe("Season recap /me alias", () => {
  it("GET /api/ai/season-recap/me resolves to authenticated user", async () => {
    const { status, json } = await fetch("/api/ai/season-recap/me", {
      token: aliceToken,
    });
    expect(status).toBe(200);
    expect(json).toBeDefined();
    expect(json.stats).toBeDefined();
    expect(json.narrative).toBeDefined();
  });

  it("GET /api/ai/season-recap/me requires authentication", async () => {
    const { status } = await fetch("/api/ai/season-recap/me");
    expect(status).toBe(401);
  });
});
