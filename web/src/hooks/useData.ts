import { useState, useEffect, useCallback } from "react";
import { useStore } from "@/hooks/useStore";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import type {
  ReplayResult,
  RoundRecord,
  Course,
  Attestation,
  FriendInfo,
  PlayInvitation,
} from "@store/interface.js";

export function useReplay() {
  const store = useStore();
  const [data, setData] = useState<ReplayResult | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const result = await store.getReplayResult();
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [store]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, refetch: fetch };
}

export function useRounds() {
  const store = useStore();
  const [rounds, setRounds] = useState<RoundRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const result = await store.getRoundRecords();
      setRounds(result);
    } catch {
      setRounds([]);
    } finally {
      setLoading(false);
    }
  }, [store]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { rounds, loading, refetch: fetch };
}

export function useCourses() {
  const store = useStore();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    store
      .getCourses()
      .then(setCourses)
      .catch(() => setCourses([]))
      .finally(() => setLoading(false));
  }, [store]);

  return { courses, loading };
}

export function useFriends() {
  const store = useStore();
  const { user } = useAuth();
  const [friends, setFriends] = useState<FriendInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const result = await store.getFriends();
      setFriends(result);
    } catch {
      setFriends([]);
    } finally {
      setLoading(false);
    }
  }, [store]);

  useEffect(() => {
    fetch();
  }, [fetch, user?.id]);

  return { friends, loading, refetch: fetch };
}

export function useAttestations() {
  const store = useStore();
  const [attestations, setAttestations] = useState<Attestation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const result = await store.getPendingAttestations();
      setAttestations(result);
    } catch {
      setAttestations([]);
    } finally {
      setLoading(false);
    }
  }, [store]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { attestations, loading, refetch: fetch };
}

export function usePlayInvitations() {
  const { user } = useAuth();
  const [sent, setSent] = useState<PlayInvitation[]>([]);
  const [received, setReceived] = useState<PlayInvitation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<{ sent: PlayInvitation[]; received: PlayInvitation[] }>(
        "/play-invitations"
      );
      setSent(result.sent);
      setReceived(result.received);
    } catch {
      setSent([]);
      setReceived([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch, user?.id]);

  return { sent, received, loading, refetch: fetch };
}
