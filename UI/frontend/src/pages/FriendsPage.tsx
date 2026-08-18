import { Link } from "react-router-dom";
import { useFriends, useReplay, usePlayInvitations } from "@/hooks/useData";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/hooks/useStore";
import { useState, useEffect, useMemo } from "react";
import { buildConnectivity, getConnectivity } from "@/lib/connectivity";
import { t } from "@/lib/i18n";
import styles from "./FriendsPage.module.css";

export default function FriendsPage() {
  const { friends, loading, refetch } = useFriends();
  const { data: replay } = useReplay();
  const { user } = useAuth();
  const store = useStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; display_name: string; home_club?: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pendingRequests, setPendingRequests] = useState<{ sent: unknown[]; received: unknown[] }>({ sent: [], received: [] });
  const [requestMessage, setRequestMessage] = useState("");
  const [activeRecipient, setActiveRecipient] = useState<string | null>(null);
  const { received: playInvites, refetch: refetchInvites } = usePlayInvitations();

  const connectivity = useMemo(
    () => (replay ? buildConnectivity(replay) : null),
    [replay]
  );

  // User's own connectivity
  const myConn = user && connectivity ? getConnectivity(connectivity, user.id) : null;

  const loadRequests = async () => {
    try {
      const data = await api.get<{ sent: unknown[]; received: unknown[] }>("/friends/requests");
      setPendingRequests(data);
    } catch {}
  };

  // Load requests on mount
  useEffect(() => {
    loadRequests();
  }, []);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError("");
    try {
      const results = await api.get<{ id: string; display_name: string; home_club?: string }[]>(
        `/users/search?q=${encodeURIComponent(searchQuery)}`
      );
      const friendIds = new Set(friends.map((f) => f.id ?? f.userId));
      setSearchResults(results.filter((u) => !friendIds.has(u.id)));
    } catch {
      setError(t("Search failed"));
    } finally {
      setSearching(false);
    }
  };

  const sendRequest = async (toId: string) => {
    try {
      await api.post("/friends/request", { toId, message: requestMessage });
      setSuccess(t("Friend request sent"));
      setTimeout(() => setSuccess(""), 3000);
      setRequestMessage("");
      setActiveRecipient(null);
      loadRequests();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Failed to send request"));
    }
  };

  const acceptRequest = async (requestId: string) => {
    try {
      await api.post(`/friends/accept/${requestId}`);
      refetch();
      loadRequests();
      setSuccess(t("Friend added"));
      setTimeout(() => setSuccess(""), 3000);
    } catch {
      setError(t("Failed to accept"));
    }
  };

  const removeFriend = async (friendId: string) => {
    try {
      await api.post(`/friends/remove/${friendId}`);
      refetch();
    } catch {
      setError(t("Failed to remove"));
    }
  };

  const toggleRegular = async (friendId: string, current: boolean) => {
    try {
      await store.setFriendRegular(friendId, !current);
      refetch();
    } catch {
      setError(t("Failed to update"));
    }
  };

  const acceptInvite = async (id: string) => {
    try {
      await api.post(`/play-invitations/${id}/accept`);
      setSuccess(t("Invitation accepted"));
      setTimeout(() => setSuccess(""), 3000);
      refetchInvites();
    } catch {
      setError(t("Failed to accept invitation"));
    }
  };

  const declineInvite = async (id: string) => {
    try {
      await api.post(`/play-invitations/${id}/decline`);
      refetchInvites();
    } catch {
      setError(t("Failed to decline invitation"));
    }
  };

  // Sort: regulars first
  const sortedFriends = [...friends].sort((a: any, b: any) => {
    if (a.is_regular && !b.is_regular) return -1;
    if (!a.is_regular && b.is_regular) return 1;
    return 0;
  });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.title}>{t("Friends")}</h2>
        <span className={styles.count}>{friends.length}</span>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {success && <div className={styles.success}>{success}</div>}

      {/* User's own connectivity */}
      {myConn && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("Your connectivity")}</h3>
          <p className={`${styles.connectivityLabel} ${myConn.isWarning ? styles.cWarning : styles.cOk}`}>
            {myConn.connectivityLabel}
          </p>
          {myConn.diversityWarning && (
            <p className={styles.diversityWarning}>{myConn.diversityWarning}</p>
          )}
        </section>
      )}

      {/* Friend list */}
      {loading ? (
        <div className={styles.loading}>{t("Loading...")}</div>
      ) : friends.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>♡</span>
          <p className={styles.emptyTitle}>{t("No friends yet")}</p>
          <p className={styles.emptySub}>{t("Search for players below to start building your golf network.")}</p>
        </div>
      ) : (
        <div className={styles.list}>
          {sortedFriends.map((f: any) => {
            const id = f.userId || f.id || "";
            const name = f.display_name || f.displayName || id;
            const isRegular = f.isRegular === true;
            const conn = connectivity ? getConnectivity(connectivity, id) : null;
            return (
              <div key={id} className={`${styles.row} rule-bottom`}>
                <div className={styles.friendInfo}>
                  <span className={styles.name}>
                    {name}
                    {isRegular && <span className={styles.regularMark}> {t("Regular")}</span>}
                  </span>
                  {(f.home_club || f.homeClub) && (
                    <span className={styles.club}>{f.home_club || f.homeClub}</span>
                  )}
                  {conn && (
                    <span className={`${styles.cLabel} ${conn.isWarning ? styles.cWarning : styles.cOk}`}>
                      {conn.connectivityLabel}
                    </span>
                  )}
                </div>
                <div className={styles.friendActions}>
                  <Link
                    to={`/player/${id}`}
                    className={styles.regularBtn}
                    title={t("View profile")}
                  >
                    →
                  </Link>
                  <button
                    className={`${styles.regularBtn} ${isRegular ? styles.regularBtnActive : ""}`}
                    onClick={() => toggleRegular(id, isRegular)}
                    title={isRegular ? t("Remove from regular group") : t("Add to regular group")}
                  >
                    {isRegular ? "★" : "☆"}
                  </button>
                  <button className={styles.removeBtn} onClick={() => removeFriend(id)}>
                    {t("Remove")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Play invitations received */}
      {playInvites.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("Invitations to Play")}</h3>
          {playInvites.map((inv: any) => (
            <div key={inv.id} className={`${styles.row} rule-bottom`}>
              <div className={styles.friendInfo}>
                <span className={styles.name}>{inv.display_name || inv.displayName}</span>
                {inv.proposed_date && (
                  <span className={styles.club}>{t("Proposed date: {date}", { date: inv.proposed_date })}</span>
                )}
                {inv.message && (
                  <span className={styles.reqMessage}>{inv.message}</span>
                )}
              </div>
              <div className={styles.reqActions}>
                <button className={styles.acceptBtn} onClick={() => acceptInvite(inv.id)}>
                  {t("Accept")}
                </button>
                <button className={styles.ignoreBtn} onClick={() => declineInvite(inv.id)}>
                  {t("Decline")}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Pending received */}
      {pendingRequests.received.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("Requests Received")}</h3>
          {pendingRequests.received.map((r: any) => (
            <div key={r.id} className={`${styles.row} rule-bottom`}>
              <div className={styles.friendInfo}>
                <span className={styles.name}>{r.display_name}</span>
                {r.message && (
                  <span className={styles.reqMessage}>{r.message}</span>
                )}
              </div>
              <div className={styles.reqActions}>
                <button className={styles.acceptBtn} onClick={() => acceptRequest(r.id)}>
                  {t("Accept")}
                </button>
                <button
                  className={styles.ignoreBtn}
                  onClick={async () => {
                    await api.post(`/friends/decline/${r.id}`);
                    loadRequests();
                  }}
                >
                  {t("Decline")}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Search */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("Find Players")}</h3>
        <div className={styles.searchBar}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder={t("Search by name or club...")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <button className={styles.searchBtn} onClick={handleSearch} disabled={searching}>
            {searching ? "..." : t("Search")}
          </button>
        </div>
        {searchResults.length > 0 ? (
          <div className={styles.searchResults}>
            {searchResults.map((u) => (
              <div key={u.id}>
                <div className={`${styles.row} rule-bottom`}>
                  <div>
                    <span className={styles.name}>{u.display_name}</span>
                    {u.home_club && <span className={styles.club}>{u.home_club}</span>}
                  </div>
                  <button
                    className={styles.addBtn}
                    onClick={() => setActiveRecipient(activeRecipient === u.id ? null : u.id)}
                  >
                    {activeRecipient === u.id ? t("Cancel") : t("Add")}
                  </button>
                </div>
                {activeRecipient === u.id && (
                  <div className={styles.messageRow}>
                    <input
                      type="text"
                      className={styles.messageInput}
                      placeholder={t("Add a note so they know who you are")}
                      value={requestMessage}
                      onChange={(e) => setRequestMessage(e.target.value)}
                      maxLength={200}
                    />
                    <button
                      className={styles.sendBtn}
                      onClick={() => sendRequest(u.id)}
                    >
                      {t("Send")}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : searching ? null : searchQuery.trim() ? (
          <div className={styles.noResults}>{t("No players found. Try a different name or club.")}</div>
        ) : null}
      </section>
    </div>
  );
}
