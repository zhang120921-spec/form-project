import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";

// ── Types ──

export interface MatchSuggestion {
  playerId: string;
  playerName: string;
  rating: number;
  reason: string;
  daysSinceLastPlayed: number | null;
  ratingGap: number;
}

export interface SeasonRecapStats {
  totalRounds: number;
  peakRating: number | null;
  peakDate: string | null;
  lowRating: number | null;
  lowDate: string | null;
  bestScore: number | null;
  bestScoreDate: string | null;
  worstScore: number | null;
  worstScoreDate: string | null;
  mostPlayedCourse: string | null;
  mostPlayedCourseRounds: number;
  headToHead: Array<{ opponentName: string; wins: number; losses: number }>;
  ratingTrend: number[];
  handicapTrend: number[];
  handicapIndex: number | null;
  formats: Record<string, number>;
  courseCounts: Record<string, number>;
}

export interface SeasonRecap {
  stats: SeasonRecapStats;
  narrative: string;
  period: { from: string | null; to: string | null };
}

export interface NarratorResult {
  narrative: string;
  generatedAt: string;
}

export interface PublicProfileSummary {
  id: string;
  displayName: string;
  homeClub: string | null;
  region: string | null;
  isPro: boolean;
  rating: number | null;
  matches: number;
  hcpIndex: number | null;
  rd: number | null;
  isProvisional: boolean;
}

export interface PublicProfileDetail {
  id: string;
  displayName: string;
  homeClub: string | null;
  region: string | null;
  isPro: boolean;
  rating: number | null;
  matches: number;
  hcpIndex: number | null;
  rd: number | null;
  isProvisional: boolean;
  curve: number[];
}

// ── Hooks ──

export function useMatchSuggestions() {
  const [suggestions, setSuggestions] = useState<MatchSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.post<{ suggestions: MatchSuggestion[] }>(
        "/ai/match-suggestions"
      );
      setSuggestions(result.suggestions || []);
    } catch (err: any) {
      setError(err.message || t("Failed to load suggestions"));
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { suggestions, loading, error, refetch: fetch };
}

export function useSeasonRecap(playerId: string | null) {
  const [data, setData] = useState<SeasonRecap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!playerId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<SeasonRecap>(
        `/ai/season-recap/${playerId}`
      );
      setData(result);
    } catch (err: any) {
      setError(err.message || t("Failed to load season recap"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

export function useNarrator(roundId: string | null) {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    if (!roundId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.post<NarratorResult>("/ai/narrate", {
        roundId,
      });
      setNarrative(result.narrative);
      setGeneratedAt(result.generatedAt);
    } catch (err: any) {
      setError(err.message || t("Failed to generate narration"));
    } finally {
      setLoading(false);
    }
  }, [roundId]);

  return { narrative, generatedAt, loading, error, generate };
}

export function usePublicProfiles(filter: "app" | "pro" | "all" = "app") {
  const [profiles, setProfiles] = useState<PublicProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<PublicProfileSummary[]>(
        `/public-profiles?filter=${filter}`
      );
      setProfiles(result || []);
    } catch (err: any) {
      setError(err.message || t("Failed to load profiles"));
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { profiles, loading, error, refetch: fetch };
}

export function usePublicProfile(id: string | null) {
  const [data, setData] = useState<PublicProfileDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!id) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<PublicProfileDetail>(
        `/public-profiles/${id}`
      );
      setData(result);
    } catch (err: any) {
      setError(err.message || t("Failed to load profile"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
