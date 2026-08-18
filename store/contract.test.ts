// Contract tests — run the same test suite against both LocalStore and ServerStore.
// Verifies that both implementations behave identically for the core FormStore contract.
//
// For LocalStore: uses fake-indexeddb to provide a fresh in-memory IndexedDB per test.
// For ServerStore: uses an in-memory mock HTTP server that implements the /api/* contract.

import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import type { FormStore } from "./interface.js";
import { LocalStore } from "./LocalStore.js";
import { ServerStore } from "./ServerStore.js";

// ─── Helpers ───

function makeRoundInput(
  date: string,
  format: "stroke" | "match" | "stableford",
  course: string,
  participants: { playerId: string; ags?: number; holesWon?: number; points?: number; cr: number; slope: number; pcc: number }[]
) {
  return { date, format, course, par: 72, holes: 18, participants };
}

// ─── Mock HTTP server for ServerStore tests ───
// Implements a minimal /api/* contract matching the real server's behavior.

function createMockServer() {
  const state = {
    users: new Map<string, any>(),
    rounds: new Map<string, any>(),
    courses: new Map<string, any>(),
    friendships: new Map<string, any>(),
    friendRequests: new Map<string, any>(),
    attestations: new Map<string, any>(),
    config: {
      startRating: 1500, anchorHandicap: 18, kFloor: 40, kPlacement: 80,
      placementMatches: 5, alphaStroke: 0.30, alphaMatch: 0.435,
      matchStrokeFactor: 1.45, handicapMode: "whs", rdFloor: 30, rdStart: 350,
    },
    tokens: new Map<string, string>(), // token -> userId
    resetTokens: new Map<string, { userId: string; createdAt: string }>(),
  };

  const uid = () => crypto.randomUUID();

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Helper to get userId from auth header
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const userId = token ? state.tokens.get(token) : undefined;

    // ─── Auth ───
    if (path === "/api/auth/register" && method === "POST") {
      const body = await request.json();
      const existing = [...state.users.values()].find((u) => u.email === body.email);
      if (existing) return json({ error: "Email already registered" }, 409);
      const id = uid();
      const user = {
        id, email: body.email, displayName: body.displayName,
        homeClub: body.homeClub || null, sgaHandicap: body.sgaHandicap ?? null,
        isPublic: false, createdAt: new Date().toISOString(), isAdmin: false, isSuspended: false,
        passwordHash: body.password, // not real hashing for mock
      };
      state.users.set(id, user);
      const tok = uid();
      state.tokens.set(tok, id);
      return json({
        user: { id, email: user.email, displayName: user.displayName, homeClub: user.homeClub, sgaHandicap: user.sgaHandicap, isPublic: user.isPublic },
        token: tok,
      }, 201);
    }

    if (path === "/api/auth/login" && method === "POST") {
      const body = await request.json();
      const user = [...state.users.values()].find((u) => u.email === body.email);
      if (!user || user.passwordHash !== body.password)
        return json({ error: "Invalid email or password" }, 401);
      if (user.isSuspended) return json({ error: "Account suspended" }, 403);
      const tok = uid();
      state.tokens.set(tok, user.id);
      return json({
        user: { id: user.id, email: user.email, displayName: user.displayName, homeClub: user.homeClub, sgaHandicap: user.sgaHandicap, isPublic: user.isPublic, createdAt: user.createdAt },
        token: tok,
      });
    }

    if (path === "/api/auth/session" && method === "GET") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const user = state.users.get(userId);
      if (!user) return json({ error: "User not found" }, 404);
      return json({ id: user.id, email: user.email, displayName: user.displayName, homeClub: user.homeClub, sgaHandicap: user.sgaHandicap, isPublic: user.isPublic, createdAt: user.createdAt });
    }

    if (path === "/api/auth/change-password" && method === "POST") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const body = await request.json();
      const user = state.users.get(userId);
      if (!user || user.passwordHash !== body.currentPassword)
        return json({ error: "Current password incorrect" }, 400);
      user.passwordHash = body.newPassword;
      state.users.set(userId, user);
      return json({ success: true });
    }

    if (path === "/api/auth/forgot-password" && method === "POST") {
      const body = await request.json();
      const user = [...state.users.values()].find((u) => u.email === body.email);
      if (!user) return json({ token: undefined }); // silently succeed
      const token = uid();
      state.resetTokens.set(token, { userId: user.id, createdAt: new Date().toISOString() });
      return json({ token });
    }

    if (path === "/api/auth/reset-password" && method === "POST") {
      const body = await request.json();
      const entry = state.resetTokens.get(body.token);
      if (!entry) return json({ error: "Invalid or expired reset token" }, 400);
      const user = state.users.get(entry.userId);
      if (!user) return json({ error: "User not found" }, 404);
      user.passwordHash = body.newPassword;
      state.users.set(entry.userId, user);
      state.resetTokens.delete(body.token);
      return json({ success: true });
    }

    if (path === "/api/auth/account" && method === "DELETE") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      // Remove user and related data
      for (const [id] of state.friendships) {
        const f = state.friendships.get(id)!;
        if (f.userId === userId || f.friendId === userId) state.friendships.delete(id);
      }
      for (const [id] of state.friendRequests) {
        const r = state.friendRequests.get(id)!;
        if (r.fromId === userId || r.toId === userId) state.friendRequests.delete(id);
      }
      for (const [id] of state.attestations) {
        const a = state.attestations.get(id)!;
        if (a.fromId === userId || a.toId === userId) state.attestations.delete(id);
      }
      for (const [id] of state.rounds) {
        const r = state.rounds.get(id)!;
        if (r.loggedById === userId || r.participants.some((p: any) => p.playerId === userId)) state.rounds.delete(id);
      }
      state.users.delete(userId);
      return json({ success: true });
    }

    // ─── Profile ───
    if (path === "/api/profile" && method === "GET") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const user = state.users.get(userId);
      return json({ id: user.id, email: user.email, displayName: user.displayName, homeClub: user.homeClub, sgaHandicap: user.sgaHandicap, isPublic: user.isPublic, createdAt: user.createdAt });
    }

    if (path === "/api/profile" && method === "PATCH") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const body = await request.json();
      const user = state.users.get(userId);
      if (body.displayName !== undefined) user.displayName = body.displayName;
      if (body.homeClub !== undefined) user.homeClub = body.homeClub;
      if (body.isPublic !== undefined) user.isPublic = !!body.isPublic;
      state.users.set(userId, user);
      return json({ id: user.id, email: user.email, displayName: user.displayName, homeClub: user.homeClub, sgaHandicap: user.sgaHandicap, isPublic: user.isPublic, createdAt: user.createdAt });
    }

    // ─── Public Profiles ───
    if (path === "/api/public-profiles" && method === "GET") {
      const publicUsers = [...state.users.values()]
        .filter((u) => u.isPublic)
        .map((u) => ({
          id: u.id,
          displayName: u.displayName,
          homeClub: u.homeClub || null,
          region: u.region || null,
        }));
      return json(publicUsers);
    }

    if (path.startsWith("/api/public-profiles/") && method === "GET") {
      const targetId = path.split("/").pop()!;
      const user = state.users.get(targetId);
      if (!user || !user.isPublic) return json({ error: "Not found" }, 404);
      return json({
        displayName: user.displayName,
        homeClub: user.homeClub || null,
        region: user.region || null,
        rating: 1500,
        roundsPlayed: 0,
        tier: "Unrated",
      });
    }

    // ─── Friends ───
    if (path === "/api/friends" && method === "GET") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const friends = [...state.friendships.values()]
        .filter((f) => f.userId === userId)
        .map((f) => {
          const u = state.users.get(f.friendId);
          return { id: u.id, display_name: u.displayName, home_club: u.homeClub, is_regular: f.isRegular ? 1 : 0 };
        });
      return json(friends);
    }

    if (path === "/api/friends/requests" && method === "GET") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const sent = [...state.friendRequests.values()]
        .filter((r) => r.fromId === userId && r.status === "pending")
        .map((r) => ({ id: r.id, from_id: r.fromId, to_id: r.toId, status: r.status, created_at: r.createdAt }));
      const received = [...state.friendRequests.values()]
        .filter((r) => r.toId === userId && r.status === "pending")
        .map((r) => ({ id: r.id, from_id: r.fromId, to_id: r.toId, status: r.status, created_at: r.createdAt }));
      return json({ sent, received });
    }

    if (path === "/api/friends/request" && method === "POST") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const body = await request.json();
      const toId = body.toId;
      if (toId === userId) return json({ error: "Can't add yourself" }, 400);
      const existing = [...state.friendRequests.values()].find(
        (r) => r.fromId === userId && r.toId === toId && r.status === "pending"
      );
      if (existing) return json({ error: "Request already sent" }, 409);
      const alreadyFriends = [...state.friendships.values()].some(
        (f) => f.userId === userId && f.friendId === toId
      );
      if (alreadyFriends) return json({ error: "Already friends" }, 409);
      const req = { id: uid(), fromId: userId, toId, status: "pending", createdAt: new Date().toISOString() };
      state.friendRequests.set(req.id, req);
      return json({ id: req.id, fromId: req.fromId, toId: req.toId, status: req.status }, 201);
    }

    if (path.startsWith("/api/friends/accept/") && method === "POST") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const reqId = path.split("/").pop()!;
      const req = state.friendRequests.get(reqId);
      if (!req || req.toId !== userId || req.status !== "pending")
        return json({ error: "Request not found" }, 404);
      req.status = "accepted";
      state.friendRequests.set(reqId, req);
      const f1 = { id: uid(), userId: req.fromId, friendId: userId, createdAt: new Date().toISOString() };
      const f2 = { id: uid(), userId, friendId: req.fromId, createdAt: new Date().toISOString() };
      state.friendships.set(f1.id, f1);
      state.friendships.set(f2.id, f2);
      return json({ success: true });
    }

    if (path.startsWith("/api/friends/decline/") && method === "POST") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const reqId = path.split("/").pop()!;
      const req = state.friendRequests.get(reqId);
      if (!req || req.toId !== userId) return json({ error: "Request not found" }, 404);
      req.status = "declined";
      state.friendRequests.set(reqId, req);
      return json({ success: true });
    }

    if (path.startsWith("/api/friends/cancel/") && method === "POST") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const reqId = path.split("/").pop()!;
      const req = state.friendRequests.get(reqId);
      if (!req || req.fromId !== userId) return json({ error: "Request not found" }, 404);
      req.status = "cancelled";
      state.friendRequests.set(reqId, req);
      return json({ success: true });
    }

    if (path.startsWith("/api/friends/remove/") && method === "POST") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const friendId = path.split("/").pop()!;
      for (const [id, f] of state.friendships) {
        if ((f.userId === userId && f.friendId === friendId) || (f.userId === friendId && f.friendId === userId)) {
          state.friendships.delete(id);
        }
      }
      return json({ success: true });
    }

    if (path.startsWith("/api/friends/regular/") && method === "POST") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const friendId = path.split("/").pop()!;
      const body = await request.json();
      const isRegular = body.isRegular === true || body.isRegular === 1;
      for (const f of state.friendships.values()) {
        if (f.userId === userId && f.friendId === friendId) {
          f.isRegular = isRegular;
        }
      }
      return json({ isRegular });
    }

    if (path === "/api/users/search" && method === "GET") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const q = (url.searchParams.get("q") || "").toLowerCase();
      const results = [...state.users.values()]
        .filter((u) => u.id !== userId && (u.displayName.toLowerCase().includes(q) || (u.homeClub || "").toLowerCase().includes(q)))
        .slice(0, 20)
        .map((u) => ({ id: u.id, display_name: u.displayName, home_club: u.homeClub }));
      return json(results);
    }

    // ─── Rounds ───
    if (path === "/api/rounds" && method === "GET") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const friendIds = [...state.friendships.values()].filter((f) => f.userId === userId).map((f) => f.friendId);
      const networkIds = new Set([userId, ...friendIds]);
      const rounds = [...state.rounds.values()]
        .filter((r) => r.status !== "disputed" && r.participants.some((p: any) => networkIds.has(p.playerId)))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => ({
          id: r.id, logged_by: r.loggedById, date: r.date, format: r.format,
          course: r.course, par: r.par, holes: r.holes, status: r.status,
          created_at: r.createdAt,
        }));
      return json(rounds);
    }

    if (path === "/api/rounds" && method === "POST") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const body = await request.json();
      if (body.participants.length < 2) return json({ error: "Need at least 2 players" }, 400);
      // Verify friends
      for (const p of body.participants) {
        if (p.playerId === userId) continue;
        const isFriend = [...state.friendships.values()].some((f) => f.userId === userId && f.friendId === p.playerId);
        if (!isFriend) return json({ error: `Not friends with ${p.playerId}` }, 403);
      }
      const id = uid();
      const round = {
        id, loggedById: userId, date: body.date, format: body.format,
        course: body.course, par: body.par || 72, holes: body.holes || 18,
        nine: "18", status: "pending_attestation", participants: body.participants,
        createdAt: new Date().toISOString(),
      };
      state.rounds.set(id, round);
      // Create attestations
      for (const p of body.participants) {
        if (p.playerId === userId) continue;
        const attId = uid();
        state.attestations.set(attId, {
          id: attId, roundId: id, fromId: userId, toId: p.playerId,
          status: "pending", createdAt: new Date().toISOString(),
        });
      }
      return json({ id, status: "pending_attestation" }, 201);
    }

    // ─── Replay ───
    if (path === "/api/replay" && method === "GET") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      // Build replay data
      const friendIds = [...state.friendships.values()].filter((f) => f.userId === userId).map((f) => f.friendId);
      const networkIds = new Set([userId, ...friendIds]);
      const networkRounds = [...state.rounds.values()]
        .filter((r) => r.status !== "disputed" && r.participants.some((p: any) => networkIds.has(p.playerId)))
        .sort((a, b) => a.date.localeCompare(b.date));

      const playerIds = new Set<string>([userId]);
      for (const r of networkRounds) {
        for (const p of r.participants) playerIds.add(p.playerId);
      }

      const players = [...playerIds].map((pid) => {
        const u = state.users.get(pid);
        return { id: u.id, name: u.displayName, club: u.homeClub || "", seed: u.sgaHandicap ?? undefined };
      });

      const rounds = networkRounds.map((r) => ({
        id: r.id, date: r.date, format: r.format, course: r.course,
        par: r.par || 72, holes: r.holes || 18, nine: r.nine,
        participants: r.participants,
      }));

      // Run replay using the engine
      const { replay, DEFAULTS } = await import("../engine/index.js");
      const result = replay(players, rounds, DEFAULTS);
      return json(result);
    }

    // ─── Attestations ───
    if (path === "/api/attestations" && method === "GET") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const atts = [...state.attestations.values()]
        .filter((a) => a.toId === userId && a.status === "pending")
        .map((a) => {
          const r = state.rounds.get(a.roundId);
          const fromUser = state.users.get(a.fromId);
          return { id: a.id, round_id: a.roundId, from_id: a.fromId, from_name: fromUser?.displayName, to_id: a.toId, status: a.status, created_at: a.createdAt, date: r?.date, format: r?.format, course: r?.course };
        });
      return json(atts);
    }

    if (path.startsWith("/api/attestations/") && path.endsWith("/confirm") && method === "POST") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const attId = path.split("/")[3];
      const att = state.attestations.get(attId);
      if (!att || att.toId !== userId || att.status !== "pending")
        return json({ error: "Not found" }, 404);
      att.status = "confirmed";
      att.confirmedAt = new Date().toISOString();
      state.attestations.set(attId, att);
      // Check if all confirmed
      const roundAtts = [...state.attestations.values()].filter((a) => a.roundId === att.roundId);
      if (roundAtts.every((a) => a.status === "confirmed")) {
        const round = state.rounds.get(att.roundId);
        if (round) { round.status = "confirmed"; state.rounds.set(att.roundId, round); }
      }
      return json({ success: true });
    }

    if (path.startsWith("/api/attestations/") && path.endsWith("/dispute") && method === "POST") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const attId = path.split("/")[3];
      const att = state.attestations.get(attId);
      if (!att || att.toId !== userId || att.status !== "pending")
        return json({ error: "Not found" }, 404);
      att.status = "disputed";
      state.attestations.set(attId, att);
      const round = state.rounds.get(att.roundId);
      if (round) { round.status = "disputed"; state.rounds.set(att.roundId, round); }
      return json({ success: true });
    }

    // ─── Courses ───
    if (path === "/api/courses" && method === "GET") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const courses = [...state.courses.values()].map((c) => ({ ...c, verified: c.verified ? 1 : 0 }));
      return json(courses);
    }

    if (path === "/api/courses" && method === "POST") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const body = await request.json();
      const id = uid();
      const course = { ...body, id, verified: !!body.verified };
      state.courses.set(id, course);
      return json({ ...course, verified: course.verified ? 1 : 0 }, 201);
    }

    // ─── Config ───
    if (path === "/api/config" && method === "GET") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      return json(state.config);
    }

    if (path === "/api/config" && method === "PATCH") {
      if (!userId) return json({ error: "Unauthorized" }, 401);
      const body = await request.json();
      Object.assign(state.config, body);
      return json(state.config);
    }

    // ─── Admin ───
    if (path === "/api/admin/users" && method === "GET") {
      const users = [...state.users.values()].map((u) => ({
        id: u.id, email: u.email, display_name: u.displayName,
        home_club: u.homeClub, sga_handicap: u.sgaHandicap,
        is_admin: u.isAdmin, is_suspended: u.isSuspended, created_at: u.createdAt,
      }));
      return json(users);
    }

    if (path === "/api/admin/recompute" && method === "POST") {
      return json({ success: true });
    }

    return json({ error: "Not found" }, 404);
  }

  return {
    fetchFn: async (input: string | URL | Request, init?: RequestInit) => {
      let url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      // Node's Request requires absolute URLs — prepend a base if relative
      if (url.startsWith("/")) url = `http://localhost${url}`;
      const request = new Request(url, init);
      return handle(request);
    },
    state,
    reset: () => {
      state.users.clear();
      state.rounds.clear();
      state.courses.clear();
      state.friendships.clear();
      state.friendRequests.clear();
      state.attestations.clear();
      state.tokens.clear();
      state.resetTokens.clear();
    },
  };
}

// ─── Contract test suite ───

function runContractTests(
  name: string,
  createStore: () => Promise<FormStore>,
  cleanup?: () => Promise<void>
) {
  describe(`${name} — FormStore contract`, () => {
    let store: FormStore;

    beforeEach(async () => {
      store = await createStore();
      if (cleanup) await cleanup();
    });

    // ─── Auth ───

    it("should register a new user", async () => {
      const user = await store.register("alice@test.golf", "password123", "Alice");
      expect(user.id).toBeTruthy();
      expect(user.email).toBe("alice@test.golf");
      expect(user.displayName).toBe("Alice");
    });

    it("should not allow duplicate registration", async () => {
      await store.register("bob@test.golf", "password123", "Bob");
      await expect(store.register("bob@test.golf", "password456", "Bob2")).rejects.toThrow();
    });

    it("should login with correct credentials", async () => {
      await store.register("carol@test.golf", "secret123", "Carol");
      await store.logout();
      const { user, token } = await store.login("carol@test.golf", "secret123");
      expect(user.displayName).toBe("Carol");
      expect(token).toBeTruthy();
    });

    it("should reject login with wrong password", async () => {
      await store.register("dave@test.golf", "correct123", "Dave");
      await store.logout();
      await expect(store.login("dave@test.golf", "wrong")).rejects.toThrow();
    });

    it("should get session after login", async () => {
      const registered = await store.register("eve@test.golf", "pass123", "Eve");
      const session = await store.getSession();
      expect(session).not.toBeNull();
      expect(session!.id).toBe(registered.id);
    });

    it("should return null session after logout", async () => {
      await store.register("frank@test.golf", "pass123", "Frank");
      await store.logout();
      const session = await store.getSession();
      expect(session).toBeNull();
    });

    // ─── Profile ───

    it("should get and update profile", async () => {
      await store.register("grace@test.golf", "pass123", "Grace");
      const profile = await store.getProfile();
      expect(profile.displayName).toBe("Grace");

      const updated = await store.updateProfile({ homeClub: "Sentosa GC", isPublic: true });
      expect(updated.homeClub).toBe("Sentosa GC");
      expect(updated.isPublic).toBe(true);

      const toggledOff = await store.updateProfile({ isPublic: false });
      expect(toggledOff.isPublic).toBe(false);
    });

    // ─── Friends ───

    it("should handle friend request lifecycle", async () => {
      // Create two users
      const alice = await store.register("alice@friends.golf", "pass123", "Alice");
      // For ServerStore, we need to register Bob with a different store session
      // But since the mock server shares state, we can register Bob via the same store
      // then switch back to Alice
      const bob = await store.register("bob@friends.golf", "pass123", "Bob");

      // For LocalStore, we need to log back in as Alice
      // For ServerStore (mock), the token changes on register
      await store.logout();
      await store.login("alice@friends.golf", "pass123");

      // Alice sends friend request to Bob
      const req = await store.sendFriendRequest(bob.id);
      expect(req.status).toBe("pending");
      expect(req.fromId).toBe(alice.id);
      expect(req.toId).toBe(bob.id);

      // Check pending requests
      const { sent, received } = await store.getPendingRequests();
      expect(sent.length).toBe(1);
      expect(sent[0].toId).toBe(bob.id);
      expect(received.length).toBe(0);

      // Switch to Bob
      await store.logout();
      await store.login("bob@friends.golf", "pass123");

      // Bob should have received request
      const { received: bobReceived } = await store.getPendingRequests();
      expect(bobReceived.length).toBe(1);
      expect(bobReceived[0].fromId).toBe(alice.id);

      // Bob accepts
      await store.acceptFriendRequest(req.id);

      // Both should be friends now
      const bobFriends = await store.getFriends();
      expect(bobFriends.some((f) => f.userId === alice.id)).toBe(true);

      // Switch back to Alice
      await store.logout();
      await store.login("alice@friends.golf", "pass123");

      const aliceFriends = await store.getFriends();
      expect(aliceFriends.some((f) => f.userId === bob.id)).toBe(true);

      // Toggle regular status
      await store.setFriendRegular(bob.id, true);
      const regularFriends = await store.getFriends();
      const bobFriend = regularFriends.find((f) => f.userId === bob.id);
      expect(bobFriend?.isRegular).toBe(true);

      await store.setFriendRegular(bob.id, false);
      const notRegularFriends = await store.getFriends();
      const bobFriend2 = notRegularFriends.find((f) => f.userId === bob.id);
      expect(bobFriend2?.isRegular).toBe(false);
    });

    it("should search users", async () => {
      await store.register("searcher@test.golf", "pass123", "Searcher");
      await store.register("search1@test.golf", "pass123", "SearchableUser");
      // Switch back to searcher
      await store.logout();
      await store.login("searcher@test.golf", "pass123");
      const results = await store.searchUsers("Searchable");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((r) => r.displayName === "SearchableUser")).toBe(true);
    });

    it("should decline friend requests", async () => {
      const alice = await store.register("alice@decline.golf", "pass123", "Alice");
      const bob = await store.register("bob@decline.golf", "pass123", "Bob");

      // Switch to Alice
      await store.logout();
      await store.login("alice@decline.golf", "pass123");

      const req = await store.sendFriendRequest(bob.id);

      // Switch to Bob
      await store.logout();
      await store.login("bob@decline.golf", "pass123");

      await store.declineFriendRequest(req.id);

      // Should not be friends
      const friends = await store.getFriends();
      expect(friends.some((f) => f.userId === alice.id)).toBe(false);
    });

    it("should remove friends", async () => {
      const alice = await store.register("alice@remove.golf", "pass123", "Alice");
      const bob = await store.register("bob@remove.golf", "pass123", "Bob");

      // Switch to Alice
      await store.logout();
      await store.login("alice@remove.golf", "pass123");

      const req = await store.sendFriendRequest(bob.id);

      // Switch to Bob
      await store.logout();
      await store.login("bob@remove.golf", "pass123");

      await store.acceptFriendRequest(req.id);

      // Verify friends
      let friends = await store.getFriends();
      expect(friends.some((f) => f.userId === alice.id)).toBe(true);

      // Remove friend
      await store.removeFriend(alice.id);
      friends = await store.getFriends();
      expect(friends.some((f) => f.userId === alice.id)).toBe(false);
    });

    // ─── Rounds & Replay ───

    it("should save and retrieve rounds", async () => {
      const alice = await store.register("alice@rounds.golf", "pass123", "Alice");
      const bob = await store.register("bob@rounds.golf", "pass123", "Bob");

      // Switch to Alice
      await store.logout();
      await store.login("alice@rounds.golf", "pass123");

      // Become friends
      const req = await store.sendFriendRequest(bob.id);
      await store.logout();
      await store.login("bob@rounds.golf", "pass123");
      await store.acceptFriendRequest(req.id);

      // Switch to Alice
      await store.logout();
      await store.login("alice@rounds.golf", "pass123");

      // Log a round
      const roundInput = makeRoundInput("2026-06-01", "stroke", "Test Course", [
        { playerId: alice.id, ags: 85, cr: 72.0, slope: 130, pcc: 0 },
        { playerId: bob.id, ags: 80, cr: 72.0, slope: 130, pcc: 0 },
      ]);
      const record = await store.logRound(roundInput);
      expect(record.id).toBeTruthy();
      expect(record.status).toBe("pending_attestation");

      // Retrieve rounds
      const rounds = await store.getRoundRecords();
      expect(rounds.length).toBeGreaterThanOrEqual(1);
    });

    it("should return consistent replay results", async () => {
      const alice = await store.register("alice@replay.golf", "pass123", "Alice");
      const bob = await store.register("bob@replay.golf", "pass123", "Bob");

      // Switch to Alice
      await store.logout();
      await store.login("alice@replay.golf", "pass123");

      // Become friends
      const req = await store.sendFriendRequest(bob.id);
      await store.logout();
      await store.login("bob@replay.golf", "pass123");
      await store.acceptFriendRequest(req.id);

      // Switch to Alice
      await store.logout();
      await store.login("alice@replay.golf", "pass123");

      // Log multiple rounds
      await store.logRound(makeRoundInput("2026-06-01", "stroke", "Course A", [
        { playerId: alice.id, ags: 85, cr: 72.0, slope: 130, pcc: 0 },
        { playerId: bob.id, ags: 80, cr: 72.0, slope: 130, pcc: 0 },
      ]));
      await store.logRound(makeRoundInput("2026-06-08", "stroke", "Course B", [
        { playerId: alice.id, ags: 82, cr: 71.4, slope: 125, pcc: 0 },
        { playerId: bob.id, ags: 78, cr: 71.4, slope: 125, pcc: 0 },
      ]));

      // Run replay twice — should be identical
      const result1 = await store.getReplayResult();
      const result2 = await store.getReplayResult();

      expect(result1.rounds.length).toBe(result2.rounds.length);
      expect(result1.players.length).toBe(result2.players.length);

      // Player ratings should be identical
      for (let i = 0; i < result1.players.length; i++) {
        expect(result1.players[i].rating).toBeCloseTo(result2.players[i].rating, 10);
        expect(result1.players[i].matches).toBe(result2.players[i].matches);
      }

      // Both players should exist
      const aliceState = result1.players.find((p) => p.id === alice.id);
      const bobState = result1.players.find((p) => p.id === bob.id);
      expect(aliceState).toBeDefined();
      expect(bobState).toBeDefined();
      expect(aliceState!.matches).toBe(2);
      expect(bobState!.matches).toBe(2);
    });

    it("should return players from replay", async () => {
      const alice = await store.register("alice@players.golf", "pass123", "Alice");
      const bob = await store.register("bob@players.golf", "pass123", "Bob");

      // Switch to Alice
      await store.logout();
      await store.login("alice@players.golf", "pass123");

      // Become friends
      const req = await store.sendFriendRequest(bob.id);
      await store.logout();
      await store.login("bob@players.golf", "pass123");
      await store.acceptFriendRequest(req.id);

      // Switch to Alice
      await store.logout();
      await store.login("alice@players.golf", "pass123");

      // Log a round so both players appear in replay data
      await store.logRound(makeRoundInput("2026-06-01", "stroke", "Test Course", [
        { playerId: alice.id, ags: 85, cr: 72.0, slope: 130, pcc: 0 },
        { playerId: bob.id, ags: 80, cr: 72.0, slope: 130, pcc: 0 },
      ]));

      const players = await store.getPlayers();
      expect(players.some((p) => p.id === alice.id)).toBe(true);
      expect(players.some((p) => p.id === bob.id)).toBe(true);
    });

    // ─── Attestation ───

    it("should handle attestation flow", async () => {
      const alice = await store.register("alice@attest.golf", "pass123", "Alice");
      const bob = await store.register("bob@attest.golf", "pass123", "Bob");

      // Switch to Alice
      await store.logout();
      await store.login("alice@attest.golf", "pass123");

      // Become friends
      const req = await store.sendFriendRequest(bob.id);
      await store.logout();
      await store.login("bob@attest.golf", "pass123");
      await store.acceptFriendRequest(req.id);

      // Switch to Alice
      await store.logout();
      await store.login("alice@attest.golf", "pass123");

      // Log a round — Bob needs to attest
      const record = await store.logRound(makeRoundInput("2026-07-01", "stroke", "Attest Course", [
        { playerId: alice.id, ags: 85, cr: 72.0, slope: 130, pcc: 0 },
        { playerId: bob.id, ags: 80, cr: 72.0, slope: 130, pcc: 0 },
      ]));

      // Alice should have no pending attestations
      const aliceAtts = await store.getPendingAttestations();
      expect(aliceAtts.length).toBe(0);

      // Switch to Bob
      await store.logout();
      await store.login("bob@attest.golf", "pass123");

      // Bob should have a pending attestation
      const bobAtts = await store.getPendingAttestations();
      expect(bobAtts.length).toBe(1);
      expect(bobAtts[0].roundId).toBe(record.id);
      expect(bobAtts[0].status).toBe("pending");

      // Bob confirms
      await store.confirmRound(bobAtts[0].id);

      // No more pending
      const afterConfirm = await store.getPendingAttestations();
      expect(afterConfirm.length).toBe(0);

      // Round should be confirmed (both attestations done — only Bob needed to attest)
      // Switch to Alice to check
      await store.logout();
      await store.login("alice@attest.golf", "pass123");
      const rounds = await store.getRoundRecords();
      const loggedRound = rounds.find((r) => r.id === record.id);
      expect(loggedRound?.status).toBe("confirmed");
    });

    it("should handle round dispute", async () => {
      const alice = await store.register("alice@dispute.golf", "pass123", "Alice");
      const bob = await store.register("bob@dispute.golf", "pass123", "Bob");

      // Switch to Alice
      await store.logout();
      await store.login("alice@dispute.golf", "pass123");

      // Become friends
      const req = await store.sendFriendRequest(bob.id);
      await store.logout();
      await store.login("bob@dispute.golf", "pass123");
      await store.acceptFriendRequest(req.id);

      // Switch to Alice
      await store.logout();
      await store.login("alice@dispute.golf", "pass123");

      const record = await store.logRound(makeRoundInput("2026-07-01", "stroke", "Dispute Course", [
        { playerId: alice.id, ags: 85, cr: 72.0, slope: 130, pcc: 0 },
        { playerId: bob.id, ags: 80, cr: 72.0, slope: 130, pcc: 0 },
      ]));

      // Switch to Bob
      await store.logout();
      await store.login("bob@dispute.golf", "pass123");

      const atts = await store.getPendingAttestations();
      expect(atts.length).toBe(1);

      await store.disputeRound(atts[0].id, "Score disagreement");

      // Round should be disputed — disputed rounds are excluded from replay
      const replay = await store.getReplayResult();
      expect(replay.rounds.every((r) => r.id !== record.id)).toBe(true);
    });

    // ─── Courses ───

    it("should create and retrieve courses", async () => {
      await store.register("course@test.golf", "pass123", "CourseTester");

      const course = await store.addCourse({
        name: "Test Golf Club",
        club: "Test",
        tees: [{ name: "White", colour: "White", par: 72, cr: 72.0, slope: 130 }],
        verified: false,
      });
      expect(course.id).toBeTruthy();
      expect(course.name).toBe("Test Golf Club");

      const courses = await store.getCourses();
      expect(courses.some((c) => c.id === course.id)).toBe(true);
    });

    // ─── Config ───

    it("should get and update config", async () => {
      await store.register("config@test.golf", "pass123", "ConfigTester");

      const config = await store.getConfig();
      expect(config.startRating).toBe(1500);

      const updated = await store.updateConfig({ kFloor: 50 });
      expect(updated.kFloor).toBe(50);
    });
  });
}

// ─── Run contract tests for LocalStore ───

describe("LocalStore contract", () => {
  let dbCounter = 0;

  runContractTests(
    "LocalStore",
    async () => {
      // Fresh IndexedDB per test
      (globalThis as any).indexedDB = new IDBFactory();
      const { LocalStore } = await import("./LocalStore.js");
      const dbName = `form-test-${Date.now()}-${dbCounter++}`;
      return new LocalStore(dbName);
    }
  );
});

// ─── Run contract tests for ServerStore (with mock server) ───

describe("ServerStore contract", () => {
  let mockServer: ReturnType<typeof createMockServer>;

  runContractTests(
    "ServerStore",
    async () => {
      mockServer = createMockServer();
      const { ServerStore } = await import("./ServerStore.js");
      return new ServerStore({
        baseUrl: "/api",
        fetchFn: mockServer.fetchFn as typeof fetch,
      });
    },
    async () => {
      // Reset mock server state between tests
      mockServer?.reset();
    }
  );
});
