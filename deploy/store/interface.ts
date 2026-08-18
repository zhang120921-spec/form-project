// FormStore — single data-access interface for the entire application
// Implementations: LocalStore (IndexedDB), ServerStore (REST)

import type { EngineConfig } from "../engine/index.js";
import type { Player, Round, ReplayResult } from "../engine/index.js";

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  homeClub?: string;
  region?: string;
  sgaHandicap?: number; // seeds 20 differentials
  isPublic?: boolean;
  createdAt: string;
}

export interface FriendRequest {
  id: string;
  fromId: string;
  toId: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  createdAt: string;
}

export interface FriendInfo {
  userId: string;
  displayName: string;
  homeClub?: string;
  isRegular?: boolean;
}

export interface Attestation {
  id: string;
  roundId: string;
  fromId: string; // who logged the round
  fromName?: string; // display name of who logged the round
  toId: string; // who needs to confirm
  status: "pending" | "confirmed" | "disputed" | "expired";
  date?: string;     // round date (from JOIN)
  format?: string;   // round format (from JOIN)
  course?: string;   // round course name (from JOIN)
  createdAt: string;
  confirmedAt?: string;
}

export interface Course {
  id: string;
  name: string;
  club?: string;
  tees: Tee[];
  verified: boolean;
  source?: string;
}

export interface Tee {
  name: string;
  colour: string;
  yardage?: number;
  par: number;
  cr: number;
  slope: number;
  cr9?: number;
  slope9?: number;
}

export interface RoundInput {
  date: string;
  format: "stroke" | "match" | "stableford";
  course: string;
  par?: number;
  holes?: number;
  participants: {
    playerId: string;
    ags?: number;
    holesWon?: number;
    points?: number;
    cr: number;
    slope: number;
    pcc: number;
  }[];
}

export interface AIAnalysis {
  narration?: string;
  flagged?: boolean;
  flagReason?: string;
}

export interface RoundRecord extends RoundInput {
  id: string;
  loggedById: string;
  status: "pending_attestation" | "confirmed" | "disputed";
  aiAnalysis?: AIAnalysis;
  createdAt: string;
}

export interface ForecastResult {
  formError: number;    // mean absolute error
  hcpError: number;     // handicap mean absolute error
  formBrier: number;    // Brier score
  hcpBrier: number;
  rounds: number;
}

export interface MatchSuggestion {
  playerId: string;
  displayName: string;
  club: string;
  rating: number;
  predictedMargin: number;
  connectivityScore: number;  // 0-1, how much this would improve graph connectivity
  reason: string;
}

export interface PlayInvitation {
  id: string;
  fromId: string;
  toId: string;
  message?: string;
  proposedDate?: string;
  status: "pending" | "accepted" | "declined";
  displayName?: string;
  createdAt?: string;
}

// ═══════════════ The interface ═══════════════

export interface FormStore {
  // Auth
  register(email: string, password: string, displayName: string, homeClub?: string, sgaHandicap?: number): Promise<UserProfile>;
  login(email: string, password: string): Promise<{ user: UserProfile; token: string }>;
  logout(): Promise<void>;
  getSession(): Promise<UserProfile | null>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  requestPasswordReset(email: string): Promise<{ token?: string }>;
  resetPassword(token: string, newPassword: string): Promise<void>;
  deleteAccount(): Promise<void>;

  // Profile
  getProfile(): Promise<UserProfile>;
  updateProfile(data: Partial<Pick<UserProfile, "displayName" | "homeClub" | "region" | "sgaHandicap" | "isPublic">>): Promise<UserProfile>;

  // Players
  getPlayers(): Promise<Player[]>;
  getPlayer(id: string): Promise<Player | null>;

  // Rounds
  getRounds(): Promise<Round[]>;
  logRound(input: RoundInput): Promise<RoundRecord>;
  getRoundRecords(): Promise<RoundRecord[]>;
  deleteRound(id: string): Promise<void>;

  // Replay & ratings (computed, never stored)
  getReplayResult(): Promise<ReplayResult>;

  // Friends
  getFriends(): Promise<FriendInfo[]>;
  sendFriendRequest(toId: string): Promise<FriendRequest>;
  acceptFriendRequest(requestId: string): Promise<void>;
  declineFriendRequest(requestId: string): Promise<void>;
  cancelFriendRequest(requestId: string): Promise<void>;
  removeFriend(friendId: string): Promise<void>;
  setFriendRegular(friendId: string, isRegular: boolean): Promise<void>;
  getPendingRequests(): Promise<{ sent: FriendRequest[]; received: FriendRequest[] }>;
  searchUsers(query: string): Promise<FriendInfo[]>;

  // Attestation
  getPendingAttestations(): Promise<Attestation[]>;
  confirmRound(attestationId: string): Promise<void>;
  disputeRound(attestationId: string, reason?: string): Promise<void>;
  getAttestationLink(attestationId: string): Promise<string>;

  // Courses
  getCourses(): Promise<Course[]>;
  addCourse(course: Omit<Course, "id">): Promise<Course>;
  updateCourse(id: string, data: Partial<Course>): Promise<Course>;

  // AI
  generateNarration(roundId: string): Promise<string>;
  getFairMatchProposal(players: string[], courseId: string, format: string, holes: number): Promise<{ proposal: string; winProbability: number }>;
  getMatchSuggestions(): Promise<MatchSuggestion[]>;

  // Admin
  getForecastAccuracy(): Promise<{ brierScore: number; logLoss: number; sampleSize: number } | null>;
  forceRecompute(): Promise<void>;
  listUsers(): Promise<UserProfile[]>;
  suspendUser(id: string): Promise<void>;

  // Public profiles
  getPublicProfiles(): Promise<Array<{ id: string; displayName: string; homeClub: string | null; region: string | null }>>;
  getPublicProfile(id: string): Promise<{ displayName: string; homeClub: string | null; region: string | null; rating: number; roundsPlayed: number; tier: string } | null>;

  // Config
  getConfig(): Promise<EngineConfig>;
  updateConfig(config: Partial<EngineConfig>): Promise<EngineConfig>;

  // Data management
  exportData(): Promise<string>; // JSON
  importData(json: string): Promise<void>;
  clearData(): Promise<void>;
  seedDemoData(): Promise<void>;
}
