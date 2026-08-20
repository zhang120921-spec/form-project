// Shared types used across the web client.
//
// Types that mirror the engine or store contracts (PlayerState, ReplayResult,
// ReplayedRound, RoundRecord, Attestation, PlayInvitation) live at their
// canonical source — @engine/index.ts or @store/interface.js — and get
// imported from there directly. Duplicating them here let them drift and
// caused real bugs (see the session that removed them). Only genuinely
// UI-local types belong in this file.

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
