// ServerStore — REST client FormStore implementation
// Wraps fetch() calls to /api/* endpoints. Manages a JWT token.

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
  ForecastResult,
  MatchSuggestion,
} from "./interface.js";
import type { Player, Round, ReplayResult, EngineConfig } from "../engine/index.js";
import { DEFAULTS } from "../engine/index.js";

export class ServerStore implements FormStore {
  private baseUrl: string;
  private token: string | null = null;
  private fetchFn: typeof fetch;

  constructor(options?: { baseUrl?: string; fetchFn?: typeof fetch }) {
    this.baseUrl = options?.baseUrl || "/api";
    this.fetchFn = options?.fetchFn || fetch.bind(globalThis);

    // Restore token from localStorage if available
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("form_token");
      if (stored) this.token = stored;
    }
  }

  private setToken(token: string | null) {
    this.token = token;
    if (typeof localStorage !== "undefined") {
      if (token) localStorage.setItem("form_token", token);
      else localStorage.removeItem("form_token");
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;

    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error((data as { error?: string }).error || "Request failed");
    }

    return data as T;
  }

  // ─── Snake/camel case normalization helpers ───

  private toUserProfile(raw: Record<string, unknown>): UserProfile {
    return {
      id: raw.id as string,
      email: raw.email as string,
      displayName: (raw.displayName ?? raw.display_name) as string,
      homeClub: (raw.homeClub ?? raw.home_club) as string | undefined,
      region: raw.region as string | undefined,
      sgaHandicap: (raw.sgaHandicap ?? raw.sga_handicap) as number | undefined,
      isPublic: (raw.isPublic ?? raw.is_public) as boolean | undefined,
      createdAt: (raw.createdAt ?? raw.created_at) as string,
    };
  }

  private toFriendInfo(raw: Record<string, unknown>): FriendInfo {
    const isRegularRaw = raw.isRegular ?? raw.is_regular;
    return {
      userId: (raw.userId ?? raw.id) as string,
      displayName: (raw.displayName ?? raw.display_name) as string,
      homeClub: (raw.homeClub ?? raw.home_club) as string | undefined,
      isRegular: isRegularRaw === true || isRegularRaw === 1,
    };
  }

  private toFriendRequest(raw: Record<string, unknown>): FriendRequest {
    return {
      id: raw.id as string,
      fromId: (raw.fromId ?? raw.from_id) as string,
      toId: (raw.toId ?? raw.to_id) as string,
      status: raw.status as FriendRequest["status"],
      createdAt: (raw.createdAt ?? raw.created_at) as string,
    };
  }

  private toAttestation(raw: Record<string, unknown>): Attestation {
    return {
      id: raw.id as string,
      roundId: (raw.roundId ?? raw.round_id) as string,
      fromId: (raw.fromId ?? raw.from_id) as string,
      fromName: (raw.fromName ?? raw.from_name) as string | undefined,
      toId: (raw.toId ?? raw.to_id) as string,
      status: raw.status as Attestation["status"],
      date: (raw.date) as string | undefined,
      format: (raw.format) as string | undefined,
      course: (raw.course) as string | undefined,
      createdAt: (raw.createdAt ?? raw.created_at) as string,
      confirmedAt: (raw.confirmedAt ?? raw.confirmed_at) as string | undefined,
    };
  }

  private toRoundRecord(raw: Record<string, unknown>): RoundRecord {
    const rawParticipants = (raw.participants || []) as Array<Record<string, unknown>>;
    const participants = rawParticipants.map((p) => ({
      playerId: (p.playerId ?? p.player_id) as string,
      ags: p.ags as number | undefined,
      holesWon: (p.holesWon ?? p.holes_won) as number | undefined,
      points: p.points as number | undefined,
      cr: p.cr as number,
      slope: p.slope as number,
      pcc: p.pcc as number,
    }));

    return {
      id: raw.id as string,
      date: raw.date as string,
      format: raw.format as RoundRecord["format"],
      course: raw.course as string,
      par: raw.par as number | undefined,
      holes: raw.holes as number | undefined,
      participants,
      loggedById: (raw.loggedById ?? raw.logged_by) as string,
      status: raw.status as RoundRecord["status"],
      aiAnalysis: raw.aiAnalysis as AIAnalysis | undefined,
      createdAt: (raw.createdAt ?? raw.created_at) as string,
    };
  }

  private toCourse(raw: Record<string, unknown>): Course {
    return {
      id: raw.id as string,
      name: raw.name as string,
      club: raw.club as string | undefined,
      tees: (raw.tees || []) as Course["tees"],
      verified: Boolean(raw.verified),
      source: raw.source as string | undefined,
    };
  }

  // ═══════════════ Auth ═══════════════

  async register(email: string, password: string, displayName: string, homeClub?: string, sgaHandicap?: number, consent = true): Promise<UserProfile> {
    const data = await this.request<{ user: Record<string, unknown>; token: string }>(
      "POST",
      "/auth/register",
      { email, password, displayName, homeClub, sgaHandicap, consent }
    );
    this.setToken(data.token);
    return this.toUserProfile(data.user);
  }

  async login(email: string, password: string): Promise<{ user: UserProfile; token: string }> {
    const data = await this.request<{ user: Record<string, unknown>; token: string }>(
      "POST",
      "/auth/login",
      { email, password }
    );
    this.setToken(data.token);
    return { user: this.toUserProfile(data.user), token: data.token };
  }

  async logout(): Promise<void> {
    this.setToken(null);
  }

  async getSession(): Promise<UserProfile | null> {
    if (!this.token) return null;
    try {
      const data = await this.request<Record<string, unknown>>("GET", "/auth/session");
      return this.toUserProfile(data);
    } catch {
      this.setToken(null);
      return null;
    }
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.request("POST", "/auth/change-password", { currentPassword, newPassword });
  }

  async requestPasswordReset(email: string): Promise<{ token?: string }> {
    return this.request<{ token?: string }>("POST", "/auth/forgot-password", { email });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await this.request("POST", "/auth/reset-password", { token, newPassword });
  }

  async deleteAccount(): Promise<void> {
    await this.request("DELETE", "/auth/account");
    this.setToken(null);
  }

  // ═══════════════ Profile ═══════════════

  async getProfile(): Promise<UserProfile> {
    const data = await this.request<Record<string, unknown>>("GET", "/profile");
    return this.toUserProfile(data);
  }

  async updateProfile(
    data: Partial<Pick<UserProfile, "displayName" | "homeClub" | "region" | "sgaHandicap" | "isPublic">>
  ): Promise<UserProfile> {
    const body: Record<string, unknown> = { ...data };
    const res = await this.request<Record<string, unknown>>("PATCH", "/profile", body);
    return this.toUserProfile(res);
  }

  // ═══════════════ Public Profiles ═══════════════

  async getPublicProfiles(): Promise<Array<{ id: string; displayName: string; homeClub: string | null; region: string | null }>> {
    return this.request("GET", "/public-profiles");
  }

  async getPublicProfile(id: string): Promise<{ displayName: string; homeClub: string | null; region: string | null; rating: number; roundsPlayed: number; tier: string } | null> {
    try {
      return await this.request("GET", `/public-profiles/${id}`);
    } catch {
      return null;
    }
  }

  // ═══════════════ Players ═══════════════

  async getPlayers(): Promise<Player[]> {
    const result = await this.getReplayResult();
    return result.players.map((p) => ({
      id: p.id,
      name: p.name,
      club: p.club,
      seed: p.seed,
    }));
  }

  async getPlayer(id: string): Promise<Player | null> {
    const players = await this.getPlayers();
    return players.find((p) => p.id === id) ?? null;
  }

  // ═══════════════ Rounds ═══════════════

  async getRounds(): Promise<Round[]> {
    const result = await this.getReplayResult();
    return result.rounds;
  }

  async logRound(input: RoundInput): Promise<RoundRecord> {
    const data = await this.request<Record<string, unknown>>("POST", "/rounds", input);
    return {
      ...input,
      id: data.id as string,
      loggedById: "",
      status: (data.status as RoundRecord["status"]) || "pending_attestation",
      createdAt: new Date().toISOString(),
    };
  }

  async getRoundRecords(): Promise<RoundRecord[]> {
    const data = await this.request<Record<string, unknown>[]>("GET", "/rounds");
    return data.map((r) => this.toRoundRecord(r));
  }

  async deleteRound(id: string): Promise<void> {
    await this.request("DELETE", `/rounds/${id}`);
  }

  // ═══════════════ Replay & ratings ═══════════════

  async getReplayResult(): Promise<ReplayResult> {
    return this.request<ReplayResult>("GET", "/replay");
  }

  // ═══════════════ Friends ═══════════════

  async getFriends(): Promise<FriendInfo[]> {
    const data = await this.request<Record<string, unknown>[]>("GET", "/friends");
    return data.map((r) => this.toFriendInfo(r));
  }

  async sendFriendRequest(toId: string): Promise<FriendRequest> {
    const data = await this.request<Record<string, unknown>>("POST", "/friends/request", { toId });
    return this.toFriendRequest(data);
  }

  async acceptFriendRequest(requestId: string): Promise<void> {
    await this.request("POST", `/friends/accept/${requestId}`);
  }

  async declineFriendRequest(requestId: string): Promise<void> {
    await this.request("POST", `/friends/decline/${requestId}`);
  }

  async cancelFriendRequest(requestId: string): Promise<void> {
    await this.request("POST", `/friends/cancel/${requestId}`);
  }

  async removeFriend(friendId: string): Promise<void> {
    await this.request("POST", `/friends/remove/${friendId}`);
  }

  async setFriendRegular(friendId: string, isRegular: boolean): Promise<void> {
    await this.request("POST", `/friends/regular/${friendId}`, { isRegular });
  }

  async getPendingRequests(): Promise<{ sent: FriendRequest[]; received: FriendRequest[] }> {
    const data = await this.request<{
      sent: Record<string, unknown>[];
      received: Record<string, unknown>[];
    }>("GET", "/friends/requests");
    return {
      sent: data.sent.map((r) => this.toFriendRequest(r)),
      received: data.received.map((r) => this.toFriendRequest(r)),
    };
  }

  async searchUsers(query: string): Promise<FriendInfo[]> {
    const data = await this.request<Record<string, unknown>[]>(
      "GET",
      `/users/search?q=${encodeURIComponent(query)}`
    );
    return data.map((r) => this.toFriendInfo(r));
  }

  // ═══════════════ Attestation ═══════════════

  async getPendingAttestations(): Promise<Attestation[]> {
    const data = await this.request<Record<string, unknown>[]>("GET", "/attestations");
    return data.map((r) => this.toAttestation(r));
  }

  async confirmRound(attestationId: string): Promise<void> {
    await this.request("POST", `/attestations/${attestationId}/confirm`);
  }

  async disputeRound(attestationId: string, _reason?: string): Promise<void> {
    await this.request("POST", `/attestations/${attestationId}/dispute`);
  }

  async getAttestationLink(attestationId: string): Promise<string> {
    return `/attest/${attestationId}`;
  }

  // ═══════════════ Courses ═══════════════

  async getCourses(): Promise<Course[]> {
    const data = await this.request<Record<string, unknown>[]>("GET", "/courses");
    return data.map((r) => this.toCourse(r));
  }

  async addCourse(course: Omit<Course, "id">): Promise<Course> {
    const data = await this.request<Record<string, unknown>>("POST", "/courses", course);
    return this.toCourse(data);
  }

  async updateCourse(id: string, data: Partial<Course>): Promise<Course> {
    const res = await this.request<Record<string, unknown>>("PATCH", `/courses/${id}`, data);
    return this.toCourse(res);
  }

  // ═══════════════ AI ═══════════════

  async generateNarration(roundId: string): Promise<string> {
    try {
      const data = await this.request<{ narration: string }>("POST", `/ai/narration/${roundId}`);
      return data.narration;
    } catch {
      return "Narration unavailable.";
    }
  }

  async getFairMatchProposal(
    players: string[],
    courseId: string,
    format: string,
    holes: number
  ): Promise<{ proposal: string; winProbability: number }> {
    try {
      const data = await this.request<{ proposal: string; winProbability: number }>(
        "POST",
        "/ai/fair-match",
        { players, courseId, format, holes }
      );
      return data;
    } catch {
      return { proposal: "Even match.", winProbability: 0.5 };
    }
  }

  async getMatchSuggestions(): Promise<MatchSuggestion[]> {
    try {
      return await this.request<MatchSuggestion[]>("GET", "/ai/match-suggestions");
    } catch {
      return [];
    }
  }

  // ═══════════════ Admin ═══════════════

  async getForecastAccuracy(): Promise<{ brierScore: number; logLoss: number; sampleSize: number } | null> {
    try {
      const result = await this.request<ForecastResult>("GET", "/admin/forecast");
      return {
        brierScore: result.formBrier,
        logLoss: 0, // not computed by server
        sampleSize: result.rounds,
      };
    } catch {
      return null;
    }
  }

  async forceRecompute(): Promise<void> {
    await this.request("POST", "/admin/recompute");
  }

  async listUsers(): Promise<UserProfile[]> {
    const data = await this.request<Record<string, unknown>[]>("GET", "/admin/users");
    return data.map((r) => this.toUserProfile(r));
  }

  async suspendUser(id: string): Promise<void> {
    await this.request("PATCH", `/admin/users/${id}`, { isSuspended: true });
  }

  // ═══════════════ Config ═══════════════

  async getConfig(): Promise<EngineConfig> {
    try {
      return await this.request<EngineConfig>("GET", "/config");
    } catch {
      // Return defaults if config endpoint unavailable
      return { ...DEFAULTS };
    }
  }

  async updateConfig(config: Partial<EngineConfig>): Promise<EngineConfig> {
    return this.request<EngineConfig>("PATCH", "/config", config);
  }

  // ═══════════════ Data management ═══════════════

  async exportData(): Promise<string> {
    const [profile, friends, rounds, courses, replayResult] = await Promise.all([
      this.getProfile().catch(() => null),
      this.getFriends().catch(() => []),
      this.getRoundRecords().catch(() => []),
      this.getCourses().catch(() => []),
      this.getReplayResult().catch(() => null),
    ]);

    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        profile,
        friends,
        rounds,
        courses,
        replay: replayResult,
      },
      null,
      2
    );
  }

  async importData(_json: string): Promise<void> {
    // Server doesn't support bulk import — stub
    throw new Error("Import not supported in server mode");
  }

  async clearData(): Promise<void> {
    throw new Error("Clear data not supported in server mode");
  }

  async seedDemoData(): Promise<void> {
    throw new Error("Seed demo data not supported in server mode");
  }
}
