// Shared types used across the web client

export interface User {
  id: string;
  email: string;
  displayName: string;
  homeClub?: string;
  region?: string;
  sgaHandicap?: number;
  createdAt: string;
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
  front_cr?: number;
  front_slope?: number;
  back_cr?: number;
  back_slope?: number;
}

export interface FriendInfo {
  userId?: string;
  id?: string;
  display_name?: string;
  displayName?: string;
  home_club?: string;
  homeClub?: string;
}

export interface PlayerState {
  id: string;
  name: string;
  club: string;
  rating: number;
  matches: number;
  isProvisional?: boolean;
  isPro?: boolean;
  seededRating?: number;
  rd: number;
  hcpIndex: number | null;
  daysIdle: number;
  curve: { r: number; d: string | null; label: string }[];
  differentials: number[];
}

export interface ReplayedRound {
  id: string;
  date: string;
  format: "stroke" | "match" | "stableford";
  course: string;
  par?: number;
  holes: number;
  alpha: number;
  pairs: {
    a: string;
    b: string;
    margin: number;
    score: number;
    expected: number;
    delta: number;
  }[];
  snapshot: {
    playerId: string;
    basis: number;
    before: number;
    after: number;
    delta: number;
    k: number;
    hcpBefore: number | null;
    hcp: number | null;
    hcpDelta: number | null;
  }[];
  /** Narration text stored at commit time. Null when not yet generated. */
  narration?: string | null;
  /** Source: "template" (deterministic) or "ai". */
  narrationSource?: "template" | "ai" | null;
  /** Statistical anomaly flag from engine/anomaly.ts, joined from ai_analysis. */
  flagged?: boolean;
  flagReason?: string;
}

export interface ReplayResult {
  players: PlayerState[];
  rounds: ReplayedRound[];
}

export interface RoundRecord {
  id: string;
  date: string;
  format: string;
  course: string;
  par?: number;
  holes?: number;
  status: string;
  participants?: unknown[];
  logged_by?: string;
  loggedById?: string;
  created_at?: string;
  createdAt?: string;
  /** AI-generated narration stored at commit time. Null when AI is disabled. */
  narration?: string | null;
  /** Source of narration: "template" (deterministic fallback) or "ai". */
  narrationSource?: "template" | "ai" | null;
}

export interface Attestation {
  id: string;
  round_id?: string;
  roundId?: string;
  from_id?: string;
  fromId?: string;
  from_name?: string;
  fromName?: string;
  to_id?: string;
  toId?: string;
  status: "pending" | "confirmed" | "disputed" | "expired";
  date?: string;
  format?: string;
  course?: string;
  created_at?: string;
  createdAt?: string;
}

export interface PlayInvitation {
  id: string;
  from_id?: string;
  fromId?: string;
  to_id?: string;
  toId?: string;
  message?: string;
  proposed_date?: string;
  proposedDate?: string;
  status: "pending" | "accepted" | "declined";
  display_name?: string;
  displayName?: string;
  created_at?: string;
  createdAt?: string;
}
