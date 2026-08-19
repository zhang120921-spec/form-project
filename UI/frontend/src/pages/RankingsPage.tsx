import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useReplay } from "@/hooks/useData";
import { t } from "@/lib/i18n";
import { usePublicProfiles } from "@/hooks/useAI";
import { useAuth } from "@/hooks/useAuth";
import CompactPlayerRow from "@/components/CompactPlayerRow";
import { SkeletonList } from "@/components/Skeleton";
import styles from "./RankingsPage.module.css";

type FormResult = "W" | "L" | "T";
type Tab = "friends" | "global" | "pros";

// ───── shared helpers ─────

function computeFormResults(
  playerId: string,
  rounds: { snapshot: { playerId: string; delta: number }[] }[],
  maxResults = 5
): FormResult[] {
  const results: FormResult[] = [];
  for (const round of rounds) {
    const snap = round.snapshot.find((s) => s.playerId === playerId);
    if (!snap) continue;
    if (snap.delta > 0) results.push("W");
    else if (snap.delta < 0) results.push("L");
    else results.push("T");
  }
  return results.slice(-maxResults);
}

// ───── page shell with tabs ─────

export default function RankingsPage() {
  const [tab, setTab] = useState<Tab>("friends");

  return (
    <div className={styles.page}>
      <div className={styles.tabBar}>
          {([
          ["friends", t("Friends")],
          ["global", t("Global")],
          ["pros", t("Pros")],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            className={`${styles.tab} ${tab === key ? styles.tabActive : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "friends" ? <FriendsTab /> : tab === "global" ? <GlobalTab /> : <ProsTab />}
    </div>
  );
}

// ───── Friends tab ─────
// Your personal network: friends + round partners, with form streaks

function FriendsTab() {
  const { data, loading } = useReplay();
  const { user } = useAuth();

  const playerFormResults = useMemo(() => {
    if (!data) return new Map<string, FormResult[]>();
    const map = new Map<string, FormResult[]>();
    for (const p of data.players) {
      map.set(p.id, computeFormResults(p.id, data.rounds));
    }
    return map;
  }, [data]);

  if (loading) {
    return <div className={styles.loading}><SkeletonList count={6} /></div>;
  }

  if (!data || data.players.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>☰</div>
        <p className={styles.emptyTitle}>{t("No ratings yet")}</p>
        <p className={styles.emptySub}>{t("Log a round to get started.")}</p>
        <Link to="/log" className={styles.emptyLink}>{t("Log a Round →")}</Link>
      </div>
    );
  }

  const friendPlayers = data.players.filter((p) => !p.isPro);
  const sorted = [...friendPlayers].sort((a, b) => b.rating - a.rating);

  if (sorted.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>☰</div>
        <p className={styles.emptyTitle}>{t("No friends ranked yet")}</p>
        <p className={styles.emptySub}>{t("Add friends and log rounds together to see rankings.")}</p>
        <Link to="/friends" className={styles.emptyLink}>{t("Find Players →")}</Link>
      </div>
    );
  }

  return (
    <>
      <div className={styles.header}>
        <h2 className={styles.title}>{t("Friends")}</h2>
        <span className={styles.count}>{t("{n} players", { n: sorted.length })}</span>
      </div>
      <div className={styles.list}>
        {sorted.map((p, i) => (
          <CompactPlayerRow
            key={p.id}
            player={p}
            rank={i + 1}
            totalPlayers={sorted.length}
            isYou={p.id === user?.id}
            formResults={playerFormResults.get(p.id)}
          />
        ))}
      </div>
    </>
  );
}

// ───── Global tab ─────
// All opted-in public app users, with search

function GlobalTab() {
  const { profiles, loading, error } = usePublicProfiles("app");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return profiles;
    const q = search.toLowerCase();
    return profiles.filter(
      (p) =>
        p.displayName?.toLowerCase().includes(q) ||
        p.homeClub?.toLowerCase().includes(q) ||
        p.region?.toLowerCase().includes(q)
    );
  }, [profiles, search]);

  if (loading) {
    return <div className={styles.loading}><SkeletonList count={8} /></div>;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  if (profiles.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>{t("No public profiles yet")}</p>
        <p className={styles.emptySub}>
          {t("Players who opt in to the global leaderboard will appear here.")}
        </p>
        <Link to="/profile" className={styles.emptyLink}>
          {t("Enable your profile →")}
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className={styles.searchBar}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search by name, club, or region…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className={styles.list}>
        {filtered.map((p, i) => (
          <Link
            key={p.id}
            to={`/player/${p.id}`}
            className={styles.row}
          >
            <span className={styles.rank}>#{i + 1}</span>
            <div className={styles.info}>
              <span className={styles.name}>{p.displayName}</span>
              {(p.homeClub || p.region) && (
                <span className={styles.meta}>
                  {[p.homeClub, p.region].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
            <div className={styles.stats}>
              <span className={styles.rating}>{p.rating != null ? Math.round(p.rating) : "—"}</span>
              <span className={styles.matches}>{t("{n} rounds", { n: p.matches })}</span>
            </div>
          </Link>
        ))}
        {filtered.length === 0 && (
          <p className={styles.noResults}>{t("No matches for \"{q}\"", { q: search })}</p>
        )}
      </div>
    </>
  );
}

// ───── Pros tab ─────
// Your rating compared side-by-side with each pro

function ProsTab() {
  const { profiles: pros, loading, error } = usePublicProfiles("pro");
  const { data } = useReplay();
  const { user } = useAuth();

  const myPlayer = user && data
    ? data.players.find((p) => p.id === user.id)
    : null;
  const myRating = myPlayer?.rating ?? null;

  const combined = useMemo(() => {
    const list: Array<{
      id: string;
      name: string;
      club: string | null;
      region: string | null;
      rating: number | null;
      matches: number;
      isPro: boolean;
      isYou: boolean;
    }> = [];

    if (myPlayer) {
      list.push({
        id: user!.id,
        name: user!.displayName,
        club: user!.homeClub ?? null,
        region: user!.region ?? null,
        rating: myRating,
        matches: myPlayer.matches,
        isPro: false,
        isYou: true,
      });
    }

    for (const p of pros) {
      list.push({
        id: p.id,
        name: p.displayName,
        club: p.homeClub,
        region: p.region,
        rating: p.rating,
        matches: p.matches,
        isPro: true,
        isYou: false,
      });
    }

    return list.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  }, [pros, myPlayer, user, myRating]);

  if (loading) {
    return <div className={styles.loading}><SkeletonList count={6} /></div>;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  if (pros.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>{t("No pro data available")}</p>
        <p className={styles.emptySub}>
          {t("Professional golfer ratings will appear here once loaded.")}
        </p>
      </div>
    );
  }

  return (
    <>
      {myRating != null && (
        <div className={styles.yourRatingBanner}>
          <span className={styles.yourRatingLabel}>{t("Your Rating")}</span>
          <span className={styles.yourRatingNum}>{Math.round(myRating)}</span>
        </div>
      )}

      <div className={styles.list}>
        {combined.map((p, i) => {
          const gap = myRating != null && p.rating != null
            ? Math.round(p.rating - myRating)
            : null;
          return (
            <Link
              key={p.id}
              to={p.isYou ? "/profile" : `/player/${p.id}`}
              className={`${styles.row} ${p.isYou ? styles.youRow : ""}`}
            >
              <span className={styles.rank}>#{i + 1}</span>
              <div className={styles.info}>
                <span className={styles.name}>
                  {p.isYou && <span className={styles.youMark}>{t("YOU")} </span>}
                  {p.name}
                </span>
                <span className={styles.meta}>
                  {p.isPro ? t("Pro") : [p.club, p.region].filter(Boolean).join(" · ")}
                </span>
              </div>
              <div className={styles.stats}>
                <span className={styles.rating}>
                  {p.rating != null ? Math.round(p.rating) : "—"}
                </span>
                {gap != null && !p.isYou && (
                  <span className={`${styles.gap} ${gap > 0 ? styles.gapAbove : gap < 0 ? styles.gapBelow : ""}`}>
                    {gap > 0 ? "+" : ""}{gap} {t("vs you")}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
