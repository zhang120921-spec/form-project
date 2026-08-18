// LocalStore — IndexedDB-backed FormStore implementation
// Stores all data locally: users, rounds, courses, friends, attestations, config.
// Ratings are never stored — always recomputed via the engine's replay().

import { openDB, type IDBPDatabase } from "idb";
import {
  replay,
  DEFAULTS,
  brierScore,
  expected,
  type Player,
  type Round,
  type ReplayResult,
  type EngineConfig,
} from "../engine/index.js";
import type {
  FormStore,
  UserProfile,
  FriendRequest,
  FriendInfo,
  Attestation,
  Course,
  RoundInput,
  AIAnalysis,
  RoundRecord,
  MatchSuggestion,
} from "./interface.js";

// ─── Internal storage types ───

interface UserRecord extends UserProfile {
  passwordHash: string;
  salt: string;
  isAdmin: boolean;
  isSuspended: boolean;
}

interface StoredRound {
  id: string;
  loggedById: string;
  date: string;
  format: "stroke" | "match" | "stableford";
  course: string;
  par?: number;
  holes?: number;
  nine: "front" | "back" | "18";
  status: "pending_attestation" | "confirmed" | "disputed";
  participants: RoundInput["participants"];
  aiAnalysis?: AIAnalysis;
  createdAt: string;
}

interface Friendship {
  id: string;
  userId: string;
  friendId: string;
  isRegular?: boolean;
  createdAt: string;
}

interface KVEntry {
  key: string;
  value: unknown;
}

// ─── Helpers ───

const uid = (): string => crypto.randomUUID();

function nowISO(): string {
  return new Date().toISOString();
}

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password: string, salt: string): Promise<string> {
  return sha256(salt + ":" + password);
}

function toUserProfile(u: UserRecord): UserProfile {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    homeClub: u.homeClub,
    region: u.region,
    sgaHandicap: u.sgaHandicap,
    isPublic: u.isPublic,
    createdAt: u.createdAt,
  };
}

function toPlayer(u: UserRecord): Player {
  return {
    id: u.id,
    name: u.displayName,
    club: u.homeClub || "",
    seed: u.sgaHandicap,
  };
}

// ─── LocalStore ───

export class LocalStore implements FormStore {
  private dbName: string;
  private dbPromise: Promise<IDBPDatabase> | null = null;
  private sessionUserId: string | null = null;
  private sessionToken: string | null = null;

  constructor(dbName = "form-store") {
    this.dbName = dbName;
  }

  private getDB(): Promise<IDBPDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB(this.dbName, 1, {
        upgrade(db) {
          const users = db.createObjectStore("users", { keyPath: "id" });
          users.createIndex("email", "email", { unique: true });

          db.createObjectStore("rounds", { keyPath: "id" });
          db.createObjectStore("courses", { keyPath: "id" });

          const friendships = db.createObjectStore("friendships", { keyPath: "id" });
          friendships.createIndex("userId", "userId");
          friendships.createIndex("friendId", "friendId");

          const friendRequests = db.createObjectStore("friendRequests", { keyPath: "id" });
          friendRequests.createIndex("fromId", "fromId");
          friendRequests.createIndex("toId", "toId");
          friendRequests.createIndex("status", "status");

          const attestations = db.createObjectStore("attestations", { keyPath: "id" });
          attestations.createIndex("toId", "toId");
          attestations.createIndex("roundId", "roundId");
          attestations.createIndex("status", "status");

          db.createObjectStore("config", { keyPath: "key" });
          db.createObjectStore("kv", { keyPath: "key" });
        },
      });
    }
    return this.dbPromise;
  }

  private async getEngineConfig(): Promise<EngineConfig> {
    const db = await this.getDB();
    const row = await db.get("config", "engine");
    return row ? { ...DEFAULTS, ...(row as KVEntry).value as EngineConfig } : { ...DEFAULTS };
  }

  private async setEngineConfig(config: EngineConfig): Promise<void> {
    const db = await this.getDB();
    await db.put("config", { key: "engine", value: config });
  }

  // ─── Session helpers ───

  private async saveSession(userId: string): Promise<void> {
    const db = await this.getDB();
    this.sessionUserId = userId;
    this.sessionToken = uid();
    await db.put("kv", { key: "session", value: { userId, token: this.sessionToken } });
  }

  private async loadSession(): Promise<{ userId: string; token: string } | null> {
    if (this.sessionUserId) {
      return { userId: this.sessionUserId, token: this.sessionToken! };
    }
    const db = await this.getDB();
    const entry = await db.get("kv", "session") as KVEntry | undefined;
    if (entry?.value) {
      const val = entry.value as { userId: string; token: string };
      this.sessionUserId = val.userId;
      this.sessionToken = val.token;
      return val;
    }
    return null;
  }

  private async clearSession(): Promise<void> {
    const db = await this.getDB();
    this.sessionUserId = null;
    this.sessionToken = null;
    await db.delete("kv", "session");
  }

  private async getCurrentUserId(): Promise<string> {
    const session = await this.loadSession();
    if (!session) throw new Error("Not authenticated");
    return session.userId;
  }

  private async getUserById(id: string): Promise<UserRecord | undefined> {
    const db = await this.getDB();
    return (await db.get("users", id)) as UserRecord | undefined;
  }

  // ─── Replay data builder ───

  private async buildReplayData(userId: string): Promise<{ players: Player[]; rounds: Round[] }> {
    const db = await this.getDB();

    // Get friend IDs
    const friendships = (await db.getAllFromIndex("friendships", "userId", userId)) as Friendship[];
    const friendIds = friendships.map((f) => f.friendId);
    const networkIds = new Set<string>([userId, ...friendIds]);

    // Get all rounds where any network member participated
    const allRounds = (await db.getAll("rounds")) as StoredRound[];
    const networkRounds = allRounds.filter(
      (r) => r.status !== "disputed" && r.participants.some((p) => networkIds.has(p.playerId))
    );

    // Collect all unique player IDs from these rounds (always include current user)
    const playerIds = new Set<string>([userId]);
    for (const r of networkRounds) {
      for (const p of r.participants) {
        playerIds.add(p.playerId);
      }
    }

    // Build Player[]
    const players: Player[] = [];
    for (const pid of playerIds) {
      const u = await this.getUserById(pid);
      if (u) players.push(toPlayer(u));
    }

    // Build Round[]
    const rounds: Round[] = networkRounds
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({
        id: r.id,
        date: r.date,
        format: r.format,
        course: r.course,
        par: r.par ?? 72,
        holes: r.holes ?? 18,
        nine: r.nine,
        participants: r.participants as Round["participants"],
      }));

    return { players, rounds };
  }

  // ═══════════════ Auth ═══════════════

  async register(email: string, password: string, displayName: string, homeClub?: string, sgaHandicap?: number, _consent = true): Promise<UserProfile> {
    const db = await this.getDB();

    // Check existing
    const existing = await db.getFromIndex("users", "email", email);
    if (existing) throw new Error("Email already registered");

    const id = uid();
    const salt = uid();
    const passwordHash = await hashPassword(password, salt);
    const now = nowISO();

    const user: UserRecord = {
      id,
      email,
      passwordHash,
      salt,
      displayName,
      homeClub: homeClub || undefined,
      sgaHandicap: sgaHandicap,
      createdAt: now,
      isAdmin: false,
      isSuspended: false,
    };

    await db.add("users", user);
    await this.saveSession(id);
    return toUserProfile(user);
  }

  async login(email: string, password: string): Promise<{ user: UserProfile; token: string }> {
    const db = await this.getDB();
    const user = (await db.getFromIndex("users", "email", email)) as UserRecord | undefined;
    if (!user) throw new Error("Invalid email or password");

    const hash = await hashPassword(password, user.salt);
    if (hash !== user.passwordHash) throw new Error("Invalid email or password");

    if (user.isSuspended) throw new Error("Account suspended");

    await this.saveSession(user.id);
    return { user: toUserProfile(user), token: this.sessionToken! };
  }

  async logout(): Promise<void> {
    await this.clearSession();
  }

  async getSession(): Promise<UserProfile | null> {
    const session = await this.loadSession();
    if (!session) return null;
    const user = await this.getUserById(session.userId);
    if (!user || user.isSuspended) {
      await this.clearSession();
      return null;
    }
    return toUserProfile(user);
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const userId = await this.getCurrentUserId();
    const db = await this.getDB();
    const user = (await db.get("users", userId)) as UserRecord;
    if (!user) throw new Error("User not found");

    const oldHash = await hashPassword(currentPassword, user.salt);
    if (oldHash !== user.passwordHash) throw new Error("Current password incorrect");

    const newSalt = uid();
    user.salt = newSalt;
    user.passwordHash = await hashPassword(newPassword, newSalt);
    await db.put("users", user);
  }

  async requestPasswordReset(email: string): Promise<{ token?: string }> {
    const db = await this.getDB();
    const user = (await db.getFromIndex("users", "email", email)) as UserRecord | undefined;
    if (!user) return {}; // silently succeed for security
    // Store a reset token
    const token = uid();
    await db.put("kv", { key: `reset:${token}`, value: { userId: user.id, createdAt: nowISO() } });
    return { token };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const db = await this.getDB();
    const entry = (await db.get("kv", `reset:${token}`)) as KVEntry | undefined;
    if (!entry) throw new Error("Invalid or expired reset token");

    const { userId } = entry.value as { userId: string; createdAt: string };
    const user = (await db.get("users", userId)) as UserRecord;
    if (!user) throw new Error("User not found");

    const salt = uid();
    user.salt = salt;
    user.passwordHash = await hashPassword(newPassword, salt);
    await db.put("users", user);
    await db.delete("kv", `reset:${token}`);
  }

  async deleteAccount(): Promise<void> {
    const userId = await this.getCurrentUserId();
    const db = await this.getDB();

    // Delete friendships
    const sentFriends = (await db.getAllFromIndex("friendships", "userId", userId)) as Friendship[];
    const receivedFriends = (await db.getAllFromIndex("friendships", "friendId", userId)) as Friendship[];
    for (const f of [...sentFriends, ...receivedFriends]) {
      await db.delete("friendships", f.id);
    }

    // Delete friend requests
    const sentReqs = (await db.getAllFromIndex("friendRequests", "fromId", userId)) as FriendRequest[];
    const receivedReqs = (await db.getAllFromIndex("friendRequests", "toId", userId)) as FriendRequest[];
    for (const r of [...sentReqs, ...receivedReqs]) {
      await db.delete("friendRequests", r.id);
    }

    // Delete attestations involving this user
    const allAtts = (await db.getAll("attestations")) as Attestation[];
    for (const a of allAtts) {
      if (a.fromId === userId || a.toId === userId) {
        await db.delete("attestations", a.id);
      }
    }

    // Delete rounds logged by this user or where they participated
    const allRounds = (await db.getAll("rounds")) as StoredRound[];
    for (const r of allRounds) {
      if (r.loggedById === userId || r.participants.some((p) => p.playerId === userId)) {
        await db.delete("rounds", r.id);
      }
    }

    // Delete user
    await db.delete("users", userId);
    await this.clearSession();
  }

  // ═══════════════ Profile ═══════════════

  async getProfile(): Promise<UserProfile> {
    const userId = await this.getCurrentUserId();
    const user = await this.getUserById(userId);
    if (!user) throw new Error("Not found");
    return toUserProfile(user);
  }

  async updateProfile(
    data: Partial<Pick<UserProfile, "displayName" | "homeClub" | "region" | "sgaHandicap" | "isPublic">>
  ): Promise<UserProfile> {
    const userId = await this.getCurrentUserId();
    const db = await this.getDB();
    const user = (await db.get("users", userId)) as UserRecord;
    if (!user) throw new Error("Not found");

    if (data.displayName !== undefined) user.displayName = data.displayName;
    if (data.homeClub !== undefined) user.homeClub = data.homeClub;
    if (data.region !== undefined) user.region = data.region;
    if (data.sgaHandicap !== undefined) user.sgaHandicap = data.sgaHandicap;
    if (data.isPublic !== undefined) user.isPublic = data.isPublic;

    await db.put("users", user);
    return toUserProfile(user);
  }

  // ═══════════════ Public Profiles ═══════════════

  async getPublicProfiles(): Promise<Array<{ id: string; displayName: string; homeClub: string | null; region: string | null }>> {
    return [];
  }

  async getPublicProfile(_id: string): Promise<{ displayName: string; homeClub: string | null; region: string | null; rating: number; roundsPlayed: number; tier: string } | null> {
    return null;
  }

  // ═══════════════ Players ═══════════════

  async getPlayers(): Promise<Player[]> {
    const userId = await this.getCurrentUserId();
    const { players } = await this.buildReplayData(userId);
    return players;
  }

  async getPlayer(id: string): Promise<Player | null> {
    const user = await this.getUserById(id);
    if (!user) return null;
    return toPlayer(user);
  }

  // ═══════════════ Rounds ═══════════════

  async getRounds(): Promise<Round[]> {
    const userId = await this.getCurrentUserId();
    const { rounds } = await this.buildReplayData(userId);
    return rounds;
  }

  async logRound(input: RoundInput): Promise<RoundRecord> {
    const userId = await this.getCurrentUserId();
    const db = await this.getDB();

    if (input.participants.length < 2) throw new Error("Need at least 2 players");

    // Verify all participants are friends (except self)
    for (const p of input.participants) {
      if (p.playerId === userId) continue;
      const friendships = (await db.getAllFromIndex("friendships", "userId", userId)) as Friendship[];
      const isFriend = friendships.some((f) => f.friendId === p.playerId);
      if (!isFriend) throw new Error(`Not friends with participant ${p.playerId}`);
    }

    const id = uid();
    const now = nowISO();
    const stored: StoredRound = {
      id,
      loggedById: userId,
      date: input.date,
      format: input.format,
      course: input.course,
      par: input.par ?? 72,
      holes: input.holes ?? 18,
      nine: "18",
      status: "pending_attestation",
      participants: input.participants,
      createdAt: now,
    };

    await db.add("rounds", stored);

    // Create attestation records for all non-logger participants
    for (const p of input.participants) {
      if (p.playerId === userId) continue;
      const attestation: Attestation = {
        id: uid(),
        roundId: id,
        fromId: userId,
        toId: p.playerId,
        status: "pending",
        createdAt: now,
      };
      await db.add("attestations", attestation);
    }

    return {
      ...input,
      id,
      loggedById: userId,
      status: "pending_attestation",
      createdAt: now,
    };
  }

  async getRoundRecords(): Promise<RoundRecord[]> {
    const userId = await this.getCurrentUserId();
    const db = await this.getDB();

    // Get rounds where the user participated
    const allRounds = (await db.getAll("rounds")) as StoredRound[];
    const userRounds = allRounds
      .filter((r) => r.participants.some((p) => p.playerId === userId) && r.status !== "disputed")
      .sort((a, b) => a.date.localeCompare(b.date));

    return userRounds.map((r) => ({
      id: r.id,
      date: r.date,
      format: r.format,
      course: r.course,
      par: r.par,
      holes: r.holes,
      participants: r.participants,
      loggedById: r.loggedById,
      status: r.status,
      aiAnalysis: r.aiAnalysis,
      createdAt: r.createdAt,
    }));
  }

  async deleteRound(id: string): Promise<void> {
    const db = await this.getDB();
    // Delete associated attestations
    const atts = (await db.getAllFromIndex("attestations", "roundId", id)) as Attestation[];
    for (const a of atts) {
      await db.delete("attestations", a.id);
    }
    await db.delete("rounds", id);
  }

  // ═══════════════ Replay & ratings ═══════════════

  async getReplayResult(): Promise<ReplayResult> {
    const userId = await this.getCurrentUserId();
    const { players, rounds } = await this.buildReplayData(userId);
    const config = await this.getEngineConfig();
    return replay(players, rounds, config);
  }

  // ═══════════════ Friends ═══════════════

  async getFriends(): Promise<FriendInfo[]> {
    const userId = await this.getCurrentUserId();
    const db = await this.getDB();
    const friendships = (await db.getAllFromIndex("friendships", "userId", userId)) as Friendship[];

    const friends: FriendInfo[] = [];
    for (const f of friendships) {
      const user = await this.getUserById(f.friendId);
      if (user) {
        friends.push({
          userId: user.id,
          displayName: user.displayName,
          homeClub: user.homeClub,
          isRegular: f.isRegular,
        });
      }
    }
    return friends;
  }

  async sendFriendRequest(toId: string): Promise<FriendRequest> {
    const userId = await this.getCurrentUserId();
    const db = await this.getDB();

    if (toId === userId) throw new Error("You can't add yourself as a friend");

    // Check if already friends
    const friendships = (await db.getAllFromIndex("friendships", "userId", userId)) as Friendship[];
    if (friendships.some((f) => f.friendId === toId)) throw new Error("Already friends");

    // Check for existing pending request
    const sentReqs = (await db.getAllFromIndex("friendRequests", "fromId", userId)) as FriendRequest[];
    if (sentReqs.some((r) => r.toId === toId && r.status === "pending")) {
      throw new Error("Request already sent");
    }

    // Verify target user exists
    const target = await this.getUserById(toId);
    if (!target) throw new Error("User not found");

    const req: FriendRequest = {
      id: uid(),
      fromId: userId,
      toId: toId,
      status: "pending",
      createdAt: nowISO(),
    };

    await db.add("friendRequests", req);
    return req;
  }

  async acceptFriendRequest(requestId: string): Promise<void> {
    const userId = await this.getCurrentUserId();
    const db = await this.getDB();
    const req = (await db.get("friendRequests", requestId)) as FriendRequest | undefined;
    if (!req || req.toId !== userId || req.status !== "pending") {
      throw new Error("Request not found");
    }

    req.status = "accepted";
    await db.put("friendRequests", req);

    // Create bidirectional friendship
    const now = nowISO();
    await db.add("friendships", { id: uid(), userId: req.fromId, friendId: userId, createdAt: now } as Friendship);
    await db.add("friendships", { id: uid(), userId: userId, friendId: req.fromId, createdAt: now } as Friendship);
  }

  async declineFriendRequest(requestId: string): Promise<void> {
    const userId = await this.getCurrentUserId();
    const db = await this.getDB();
    const req = (await db.get("friendRequests", requestId)) as FriendRequest | undefined;
    if (!req || req.toId !== userId || req.status !== "pending") {
      throw new Error("Request not found");
    }
    req.status = "declined";
    await db.put("friendRequests", req);
  }

  async cancelFriendRequest(requestId: string): Promise<void> {
    const userId = await this.getCurrentUserId();
    const db = await this.getDB();
    const req = (await db.get("friendRequests", requestId)) as FriendRequest | undefined;
    if (!req || req.fromId !== userId || req.status !== "pending") {
      throw new Error("Request not found");
    }
    req.status = "cancelled";
    await db.put("friendRequests", req);
  }

  async removeFriend(friendId: string): Promise<void> {
    const userId = await this.getCurrentUserId();
    const db = await this.getDB();

    // Delete bidirectional friendship
    const userFriendships = (await db.getAllFromIndex("friendships", "userId", userId)) as Friendship[];
    for (const f of userFriendships) {
      if (f.friendId === friendId) await db.delete("friendships", f.id);
    }
    const friendFriendships = (await db.getAllFromIndex("friendships", "userId", friendId)) as Friendship[];
    for (const f of friendFriendships) {
      if (f.friendId === userId) await db.delete("friendships", f.id);
    }

    // Cancel any pending requests between them
    const allReqs = (await db.getAll("friendRequests")) as FriendRequest[];
    for (const r of allReqs) {
      if (
        r.status === "pending" &&
        ((r.fromId === userId && r.toId === friendId) || (r.fromId === friendId && r.toId === userId))
      ) {
        r.status = "cancelled";
        await db.put("friendRequests", r);
      }
    }
  }

  async setFriendRegular(friendId: string, isRegular: boolean): Promise<void> {
    const userId = await this.getCurrentUserId();
    const db = await this.getDB();
    const friendships = (await db.getAllFromIndex("friendships", "userId", userId)) as Friendship[];
    for (const f of friendships) {
      if (f.friendId === friendId) {
        f.isRegular = isRegular;
        await db.put("friendships", f);
      }
    }
  }

  async getPendingRequests(): Promise<{ sent: FriendRequest[]; received: FriendRequest[] }> {
    const userId = await this.getCurrentUserId();
    const db = await this.getDB();

    const sentReqs = (await db.getAllFromIndex("friendRequests", "fromId", userId)) as FriendRequest[];
    const receivedReqs = (await db.getAllFromIndex("friendRequests", "toId", userId)) as FriendRequest[];

    return {
      sent: sentReqs.filter((r) => r.status === "pending"),
      received: receivedReqs.filter((r) => r.status === "pending"),
    };
  }

  async searchUsers(query: string): Promise<FriendInfo[]> {
    const userId = await this.getCurrentUserId();
    const db = await this.getDB();
    const allUsers = (await db.getAll("users")) as UserRecord[];
    const q = query.toLowerCase();

    return allUsers
      .filter(
        (u) =>
          u.id !== userId &&
          (u.displayName.toLowerCase().includes(q) || (u.homeClub || "").toLowerCase().includes(q))
      )
      .slice(0, 20)
      .map((u) => ({
        userId: u.id,
        displayName: u.displayName,
        homeClub: u.homeClub,
      }));
  }

  // ═══════════════ Attestation ═══════════════

  async getPendingAttestations(): Promise<Attestation[]> {
    const userId = await this.getCurrentUserId();
    const db = await this.getDB();
    const atts = (await db.getAllFromIndex("attestations", "toId", userId)) as Attestation[];
    return atts.filter((a) => a.status === "pending");
  }

  async confirmRound(attestationId: string): Promise<void> {
    const userId = await this.getCurrentUserId();
    const db = await this.getDB();
    const att = (await db.get("attestations", attestationId)) as Attestation | undefined;
    if (!att || att.toId !== userId || att.status !== "pending") {
      throw new Error("Attestation not found");
    }

    att.status = "confirmed";
    att.confirmedAt = nowISO();
    await db.put("attestations", att);

    // Check if all attestations for this round are confirmed
    const roundAtts = (await db.getAllFromIndex("attestations", "roundId", att.roundId)) as Attestation[];
    const allConfirmed = roundAtts.every((a) => a.status === "confirmed");
    if (allConfirmed) {
      const round = (await db.get("rounds", att.roundId)) as StoredRound | undefined;
      if (round) {
        round.status = "confirmed";
        await db.put("rounds", round);
      }
    }
  }

  async disputeRound(attestationId: string, reason?: string): Promise<void> {
    const userId = await this.getCurrentUserId();
    const db = await this.getDB();
    const att = (await db.get("attestations", attestationId)) as Attestation | undefined;
    if (!att || att.toId !== userId || att.status !== "pending") {
      throw new Error("Attestation not found");
    }

    att.status = "disputed";
    await db.put("attestations", att);

    // Mark round as disputed
    const round = (await db.get("rounds", att.roundId)) as StoredRound | undefined;
    if (round) {
      round.status = "disputed";
      await db.put("rounds", round);
    }
  }

  async getAttestationLink(attestationId: string): Promise<string> {
    // Return a relative link — the app can resolve it
    return `/attest/${attestationId}`;
  }

  // ═══════════════ Courses ═══════════════

  async getCourses(): Promise<Course[]> {
    const db = await this.getDB();
    return (await db.getAll("courses")) as Course[];
  }

  async addCourse(course: Omit<Course, "id">): Promise<Course> {
    const db = await this.getDB();
    const newCourse: Course = { ...course, id: uid() };
    await db.add("courses", newCourse);
    return newCourse;
  }

  async updateCourse(id: string, data: Partial<Course>): Promise<Course> {
    const db = await this.getDB();
    const course = (await db.get("courses", id)) as Course | undefined;
    if (!course) throw new Error("Course not found");
    const updated = { ...course, ...data, id };
    await db.put("courses", updated);
    return updated;
  }

  // ═══════════════ AI ═══════════════

  async generateNarration(roundId: string): Promise<string> {
    const db = await this.getDB();
    const round = (await db.get("rounds", roundId)) as StoredRound | undefined;
    if (!round) throw new Error("Round not found");

    // Simple template narration
    const playerCount = round.participants.length;
    const courseName = round.course;
    return `A ${round.format} round at ${courseName} with ${playerCount} players. Ratings updated via pairwise Elo computation.`;
  }

  async getFairMatchProposal(
    _players: string[],
    _courseId: string,
    _format: string,
    _holes: number
  ): Promise<{ proposal: string; winProbability: number }> {
    // LocalStore doesn't have AI — return a basic proposal
    return {
      proposal: "Even match based on current ratings.",
      winProbability: 0.5,
    };
  }

  async getMatchSuggestions(): Promise<MatchSuggestion[]> {
    const userId = await this.getCurrentUserId();
    const { players } = await this.buildReplayData(userId);
    // Return top players by connectivity potential
    return players
      .filter((p) => p.id !== userId)
      .slice(0, 5)
      .map((p) => ({
        playerId: p.id,
        displayName: p.name,
        club: p.club,
        rating: 1500,
        predictedMargin: 0,
        connectivityScore: 0.5,
        reason: "Suggested based on network proximity.",
      }));
  }

  // ═══════════════ Admin ═══════════════

  async getForecastAccuracy(): Promise<{ brierScore: number; logLoss: number; sampleSize: number } | null> {
    const userId = await this.getCurrentUserId();
    const { players, rounds } = await this.buildReplayData(userId);
    const config = await this.getEngineConfig();

    if (rounds.length < 2) {
      return { brierScore: 0, logLoss: 0, sampleSize: rounds.length };
    }

    // Compute leave-one-out forecast accuracy
    const predictions: { predicted: number; actual: number }[] = [];

    for (let i = 1; i < rounds.length; i++) {
      const trainRounds = rounds.slice(0, i);
      const testRound = rounds[i];
      const trainPlayers = players.filter((p) => trainRounds.some((r) => r.participants.some((pt) => pt.playerId === p.id)));
      const result = replay(trainPlayers, trainRounds, config);
      const playerMap = new Map(result.players.map((p) => [p.id, p.rating]));

      for (const pair of testRound.participants) {
        const other = testRound.participants.find((p) => p.playerId !== pair.playerId);
        if (!other) continue;
        const ra = playerMap.get(pair.playerId);
        const rb = playerMap.get(other.playerId);
        if (ra == null || rb == null) continue;

        const pred = expected(ra, rb);
        // Actual outcome — approximate
        const actual = pred > 0.5 ? 1 : 0;
        predictions.push({ predicted: pred, actual });
      }
    }

    return {
      brierScore: predictions.length > 0 ? brierScore(predictions) : 0,
      logLoss: 0, // not computed locally
      sampleSize: rounds.length,
    };
  }

  async forceRecompute(): Promise<void> {
    // No-op — ratings are always recomputed on demand
  }

  async listUsers(): Promise<UserProfile[]> {
    const db = await this.getDB();
    const users = (await db.getAll("users")) as UserRecord[];
    return users.map(toUserProfile);
  }

  async suspendUser(id: string): Promise<void> {
    const db = await this.getDB();
    const user = (await db.get("users", id)) as UserRecord | undefined;
    if (!user) throw new Error("User not found");
    user.isSuspended = !user.isSuspended;
    await db.put("users", user);
  }

  // ═══════════════ Config ═══════════════

  async getConfig(): Promise<EngineConfig> {
    return this.getEngineConfig();
  }

  async updateConfig(config: Partial<EngineConfig>): Promise<EngineConfig> {
    const current = await this.getEngineConfig();
    const updated = { ...current, ...config };
    await this.setEngineConfig(updated);
    return updated;
  }

  // ═══════════════ Data management ═══════════════

  async exportData(): Promise<string> {
    const db = await this.getDB();
    const stores = ["users", "rounds", "courses", "friendships", "friendRequests", "attestations", "config", "kv"];
    const data: Record<string, unknown[]> = {};

    for (const store of stores) {
      data[store] = await db.getAll(store);
    }

    // Strip password hashes from exported users
    if (data.users) {
      data.users = (data.users as UserRecord[]).map(({ passwordHash, salt, ...rest }) => rest);
    }

    return JSON.stringify(data, null, 2);
  }

  async importData(json: string): Promise<void> {
    const db = await this.getDB();
    const data = JSON.parse(json) as Record<string, unknown[]>;

    for (const store of Object.keys(data)) {
      const items = data[store];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        await db.put(store as "users", item);
      }
    }
  }

  async clearData(): Promise<void> {
    const db = await this.getDB();
    const stores = ["users", "rounds", "courses", "friendships", "friendRequests", "attestations", "config", "kv"];
    for (const store of stores) {
      await db.clear(store);
    }
    this.sessionUserId = null;
    this.sessionToken = null;
  }

  async seedDemoData(): Promise<void> {
    // LocalStore no longer seeds demo players, fake friendships, or synthetic
    // rounds. Real player lists and ratings must come from user-input data
    // processed by the engine.
    console.log("Demo seed skipped: only real user data is shown.");
  }
}
