import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { useStore } from "@/hooks/useStore";
import { useAuth } from "@/hooks/useAuth";

interface PendingCountsContextType {
  attestationsCount: number;
  friendRequestsCount: number;
  refetch: () => void;
}

const PendingCountsContext = createContext<PendingCountsContextType | null>(null);

/** Single source of truth for the nav attention badges (pending
 *  attestations, pending friend requests). Any page that resolves one of
 *  these (accepting a request, confirming/disputing a round) must call
 *  `refetch()` — the badge has no other way to learn the count changed. */
export function PendingCountsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const store = useStore();
  const [attestationsCount, setAttestationsCount] = useState(0);
  const [friendRequestsCount, setFriendRequestsCount] = useState(0);

  const fetch = useCallback(async () => {
    if (!user) {
      setAttestationsCount(0);
      setFriendRequestsCount(0);
      return;
    }
    try {
      const [att, reqs] = await Promise.all([
        store.getPendingAttestations(),
        store.getPendingRequests(),
      ]);
      setAttestationsCount(att.length);
      setFriendRequestsCount(reqs.received.length);
    } catch {
      // Transient failure — leave the last known counts rather than
      // flashing the badges to zero.
    }
  }, [store, user]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return (
    <PendingCountsContext.Provider
      value={{ attestationsCount, friendRequestsCount, refetch: fetch }}
    >
      {children}
    </PendingCountsContext.Provider>
  );
}

export function usePendingCounts(): PendingCountsContextType {
  const ctx = useContext(PendingCountsContext);
  if (!ctx) throw new Error("usePendingCounts must be used within a PendingCountsProvider");
  return ctx;
}
