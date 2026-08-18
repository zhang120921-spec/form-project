import { useAuth } from "@/hooks/useAuth";
import { useReplay, useAttestations } from "@/hooks/useData";
import type { Attestation } from "@/lib/types";
import { useSeasonRecap } from "@/hooks/useAI";
import { api } from "@/lib/api";
import { Link } from "react-router-dom";
import { useState, useMemo, useEffect } from "react";
import RivalryCard from "@/components/RivalryCard";
import FormStrip from "@/components/FormStrip";
import ShareModal from "@/components/ShareModal";
import AttestationDetailModal from "@/components/AttestationDetailModal";
import SeasonRecapSections from "@/components/SeasonRecapSections";
import AiBadge from "@/components/AiBadge";
import { buildRivalries } from "@/lib/rivalries";
import { buildConnectivity, getConnectivity } from "@/lib/connectivity";
import { t } from "@/lib/i18n";
import { useToast } from "@/hooks/useToast";
import { usePendingCounts } from "@/hooks/usePendingCounts";
import styles from "./ProfilePage.module.css";

type FormResult = "W" | "L" | "T";

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

export default function ProfilePage() {
  const { showToast } = useToast();
  const { refetch: refetchPendingCounts } = usePendingCounts();
  const { user, logout, updateProfile } = useAuth();
  const { data } = useReplay();
  const { attestations, refetch: refetchAtt } = useAttestations();
  const {
    data: recap,
    loading: recapLoading,
    error: recapError,
    refetch: refetchRecap,
  } = useSeasonRecap(user?.id ?? null);
  const [tab, setTab] = useState<"game" | "activity">("game");
  const [showShare, setShowShare] = useState(false);
  const [isPublic, setIsPublic] = useState(user?.isPublic ?? false);
  const [publicToggling, setPublicToggling] = useState(false);

  const [recapCopied, setRecapCopied] = useState(false);
  const [attLoading, setAttLoading] = useState<string | null>(null); // which attestation ID is being acted on
  const [detailAtt, setDetailAtt] = useState<Attestation | null>(null);

  // Sync isPublic when user changes
  useEffect(() => {
    setIsPublic(user?.isPublic ?? false);
  }, [user?.isPublic]);

  const rivalries = useMemo(
    () => (data && user ? buildRivalries(data, user.id) : []),
    [data, user]
  );

  const cleanNarrative = useMemo(
    () => recap?.narrative?.replace(/\*\*(.*?)\*\*/g, "$1") ?? "",
    [recap?.narrative]
  );

  const connectivity = useMemo(
    () => (data ? buildConnectivity(data) : null),
    [data]
  );

  const formResults = useMemo(() => {
    if (!data || !user) return [];
    return computeFormResults(user.id, data.rounds);
  }, [data, user]);

  if (!user) return null;

  const myPlayer = data?.players.find((p) => p.id === user.id);
  const pendingAttestations = attestations.filter((a) => a.status === "pending");
  const myConn = connectivity ? getConnectivity(connectivity, user.id) : null;
  const sorted = data ? [...data.players].filter((p) => !p.isPro).sort((a, b) => b.rating - a.rating) : [];
  const myRank = myPlayer ? sorted.findIndex((p) => p.id === myPlayer.id) + 1 : null;
  const confidenceLabel = myPlayer
    ? myPlayer.rd > 120 ? t("Low") : myPlayer.rd >= 60 ? t("Medium") : t("High")
    : "—";
  const myWins = myPlayer && data
    ? data.rounds.filter((r) => {
        const snap = r.snapshot.find((s) => s.playerId === myPlayer.id);
        return snap && snap.delta > 0;
      }).length
    : 0;
  const myTotalRounds = myPlayer?.matches ?? 0;
  const myWinRate = myTotalRounds > 0 ? Math.round((myWins / myTotalRounds) * 100) : 0;
  const topRival = rivalries.length > 0 ? rivalries[0] : null;

  return (
    <div className={styles.page}>
      {/* Tab bar */}
      <div className={styles.tabBar}>
        <button
          className={`${styles.tab} ${tab === "game" ? styles.tabActive : ""}`}
          onClick={() => setTab("game")}
        >
          {t("My Game")}
        </button>
        <button
          className={`${styles.tab} ${tab === "activity" ? styles.tabActive : ""}`}
          onClick={() => setTab("activity")}
        >
          {t("Activity")}
        </button>
      </div>

      {/* Tab: My Game */}
      {tab === "game" && (
        <div className={styles.tabContent}>
          {/* Profile card */}
          <section className={styles.section}>
            <div className={styles.profileCard}>
              <div className={styles.avatar}>{user.displayName.charAt(0).toUpperCase()}</div>
              <div className={styles.info}>
                <span className={styles.name}>{user.displayName}</span>
                <span className={styles.email}>{user.email}</span>
                {user.homeClub && <span className={styles.club}>{user.homeClub}</span>}
              </div>
            </div>
          </section>

          {/* Rating hero */}
          {myPlayer && (
            <section className={styles.section}>
              <div className={styles.ratingHero}>
                <div className={styles.ratingLeft}>
                  <span className={styles.ratingLabel}>{t("Rating")}</span>
                  <div className={styles.ratingRow}>
                    <span className={styles.ratingVal}>{Math.round(myPlayer.rating)}</span>
                  </div>
                  {formResults.length > 0 && (
                    <div className={styles.formStrip}>
                      <FormStrip results={formResults} showLabel />
                    </div>
                  )}
                </div>
                {myRank && (
                  <div
                    className={styles.rankBadge}
                    title={sorted.length === 1
                      ? t("You are ranked #{rank} among {total} player", { rank: myRank, total: sorted.length })
                      : t("You are ranked #{rank} among {total} players", { rank: myRank, total: sorted.length })}
                  >
                    <span className={styles.rankLabel}>RANK</span>
                    <span className={styles.rankNum}>#{myRank}</span>
                    <span className={styles.rankTotal}>{t("of {n}", { n: sorted.length })}</span>
                  </div>
                )}
              </div>

              <button className={styles.shareBtn} onClick={() => setShowShare(true)}>
                {t("Share Rating")}
              </button>
            </section>
          )}

          {/* Stats */}
          {myPlayer && (
            <section className={styles.section}>
              <div className={styles.statGrid}>
                <div className={styles.statTile}>
                  <span className={styles.statVal}>{myPlayer.matches}</span>
                  <span className={styles.statLabel}>{t("Rounds")}</span>
                </div>
                <div className={styles.statTile}>
                  <span className={styles.statVal}>
                    {myPlayer.hcpIndex != null ? myPlayer.hcpIndex.toFixed(1) : "—"}
                  </span>
                  <span className={styles.statLabel}>{t("Handicap")}</span>
                </div>
                <div className={styles.statTile}>
                  <span className={styles.statVal}>{confidenceLabel}</span>
                  <span className={styles.statLabel}>{t("Confidence")}</span>
                </div>
                <div className={styles.statTile}>
                  <span className={styles.statVal}>{myWinRate}%</span>
                  <span className={styles.statLabel}>{t("Win Rate")}</span>
                </div>
              </div>
              {myPlayer.isProvisional && (
                <div className={styles.provisional}>{t("New — still settling")}</div>
              )}
            </section>
          )}

          {myPlayer && !myPlayer.isProvisional && (
            <section className={styles.section}>
              <Link to="/sandbag" className={styles.verifiedBadge}>
                ◆ {t("Verified rating")}
              </Link>
            </section>
          )}

          {/* Season Recap */}
          {myTotalRounds > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t("Season Recap")}</h2>
              {recapLoading ? (
                <p className={styles.recapLoading}>{t("Loading season recap…")}</p>
              ) : recapError ? (
                <div className={styles.recapError}>
                  <p>{t("Couldn’t load season recap: {error}", { error: recapError })}</p>
                  <button className={styles.recapRetryBtn} onClick={refetchRecap}>
                    {t("Retry")}
                  </button>
                </div>
              ) : recap && recap.stats.totalRounds > 0 ? (
                <div className={styles.recapCard}>
                  <div className={styles.recapStats}>
                    <div className={styles.recapStat}>
                      <span className={styles.recapStatVal}>{recap.stats.totalRounds}</span>
                      <span className={styles.recapStatLabel}>{t("Rounds")}</span>
                    </div>
                    {recap.stats.peakRating != null && (
                      <div className={styles.recapStat}>
                        <span className={styles.recapStatVal}>{recap.stats.peakRating}</span>
                        <span className={styles.recapStatLabel}>{t("Peak")}</span>
                      </div>
                    )}
                    {recap.stats.lowRating != null && (
                      <div className={styles.recapStat}>
                        <span className={styles.recapStatVal}>{recap.stats.lowRating}</span>
                        <span className={styles.recapStatLabel}>{t("Low")}</span>
                      </div>
                    )}
                    {recap.stats.bestScore != null && (
                      <div className={styles.recapStat}>
                        <span className={styles.recapStatVal}>{recap.stats.bestScore}</span>
                        <span className={styles.recapStatLabel}>{t("Best")}</span>
                      </div>
                    )}
                    {recap.stats.worstScore != null && (
                      <div className={styles.recapStat}>
                        <span className={styles.recapStatVal}>{recap.stats.worstScore}</span>
                        <span className={styles.recapStatLabel}>{t("Worst")}</span>
                      </div>
                    )}
                  </div>

                  {recap.stats.mostPlayedCourse && (
                    <p className={styles.recapCourse}>
                      {t("Most played: {course} ({rounds} rounds)", {
                        course: recap.stats.mostPlayedCourse,
                        rounds: recap.stats.mostPlayedCourseRounds,
                      })}
                    </p>
                  )}

                  {recap.stats.headToHead.length > 0 && (
                    <div className={styles.recapH2H}>
                      {recap.stats.headToHead.slice(0, 3).map((h, i) => (
                        <span key={i} className={styles.recapH2HItem}>
                          {t("{name}: {wins}W-{losses}L", {
                            name: h.opponentName,
                            wins: h.wins,
                            losses: h.losses,
                          })}
                        </span>
                      ))}
                    </div>
                  )}

                  {recap.source === "ai" && <AiBadge />}
                  <SeasonRecapSections narrative={cleanNarrative} />

                  <button
                    className={styles.recapShareBtn}
                    onClick={() => {
                      const text = `${cleanNarrative}\n\n${t("{rounds} rounds · Peak {peak} · Best {best}", {
                        rounds: recap.stats.totalRounds,
                        peak: recap.stats.peakRating ?? "—",
                        best: recap.stats.bestScore ?? "—",
                      })}`;
                      navigator.clipboard?.writeText(text);
                      setRecapCopied(true);
                      setTimeout(() => setRecapCopied(false), 2000);
                    }}
                  >
                    {recapCopied ? t("Copied!") : t("Share recap")}
                  </button>
                </div>
              ) : (
                <p className={styles.recapLoading}>{t("Season recap unavailable.")}</p>
              )}
            </section>
          )}

          {/* Public profile toggle */}
          <section className={styles.section}>
            <div className={styles.toggleCard}>
              <div className={styles.toggleInfo}>
                <span className={styles.toggleLabel}>{t("Appear on global leaderboard")}</span>
                <span className={styles.toggleDesc}>
                  {t("Let other players find your profile and rating.")}
                </span>
              </div>
              <label className={`${styles.toggleSwitch} ${isPublic ? styles.toggleOn : ""} ${publicToggling ? styles.toggleDisabled : ""}`}>
                <input
                  type="checkbox"
                  checked={isPublic}
                  disabled={publicToggling}
                  onChange={async (e) => {
                    const next = e.target.checked;
                    setPublicToggling(true);
                    try {
                      await updateProfile({ isPublic: next });
                      setIsPublic(next);
                    } catch {
                      // revert on failure
                      setIsPublic(!next);
                    }
                    setPublicToggling(false);
                  }}
                />
                <span className={styles.toggleKnob} />
              </label>
            </div>
          </section>

          <section className={styles.section}>
            <Link to="/sandbag" className={styles.aboutLink}>
              {t("About FORM ratings →")}
            </Link>
          </section>

          <section className={styles.section}>
            <button className={styles.logoutBtn} onClick={logout}>
              {t("Sign Out")}
            </button>
          </section>
        </div>
      )}

      {/* Tab: Activity */}
      {tab === "activity" && (
        <div className={styles.tabContent}>
          {/* Pending attestations */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              {t("Pending Confirmations ({count})", { count: pendingAttestations.length })}
            </h2>
            {pendingAttestations.length === 0 ? (
              <p className={styles.emptyNote}>{t("No pending confirmations.")}</p>
            ) : (
              pendingAttestations.map((a) => (
                <div key={a.id} className={`${styles.attCard} rule-bottom`}>
                  <div className={styles.attHeader}>
                    {a.fromId ? (
                      <Link to={`/player/${a.fromId}`} className={styles.attFromName}>
                        {t("{name} logged a round with you", { name: a.fromName || t("A friend") })}
                      </Link>
                    ) : (
                      <span className={styles.attFromName}>
                        {t("{name} logged a round with you", { name: a.fromName || t("A friend") })}
                      </span>
                    )}
                  </div>
                  <div className={styles.attDetails}>
                    <span className={styles.attDetail}>
                      <span className={styles.attLabel}>{t("Course")}</span>
                      {a.course || "—"}
                    </span>
                    <span className={styles.attDetail}>
                      <span className={styles.attLabel}>{t("Date")}</span>
                      {a.date || "—"}
                    </span>
                    <span className={styles.attDetail}>
                      <span className={styles.attLabel}>{t("Format")}</span>
                      {a.format === "stroke" ? t("Stroke play") : a.format === "match" ? t("Match play") : (a.format || "—")}
                    </span>
                  </div>
                  <div className={styles.attActions}>
                    <button
                      className={styles.confirmBtn}
                      disabled={attLoading === a.id}
                      onClick={async () => {
                        setAttLoading(a.id);
                        try {
                          await api.post(`/attestations/${a.id}/confirm`);
                          refetchAtt();
                        } catch (e: unknown) {
                          const msg = e instanceof Error ? e.message : t("Confirm failed");
                          alert(msg);
                        } finally {
                          setAttLoading(null);
                        }
                      }}
                    >
                      {attLoading === a.id ? "..." : t("Confirm")}
                    </button>
                  <button
                    className={styles.detailBtn}
                    disabled={attLoading === a.id}
                    onClick={() => setDetailAtt(a)}
                  >
                    {t("See details")}
                  </button>
                  </div>
                </div>
              ))
            )}
          </section>

          {/* Rivalries */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{t("Rivalries")}</h2>
            <RivalryCard rivalries={rivalries} variant="full" />
          </section>

          {/* Connectivity */}
          {myConn && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t("Connectivity")}</h2>
              <p className={`${styles.cLabel} ${myConn.isWarning ? styles.cWarning : styles.cOk}`}>
                {myConn.connectivityLabel}
              </p>
              <p className={styles.cSubtitle}>
                {myConn.uniqueOpponents.length === 1
                  ? t("Based on {n} unique opponent across all your rounds.", { n: myConn.uniqueOpponents.length })
                  : t("Based on {n} unique opponents across all your rounds.", { n: myConn.uniqueOpponents.length })}
              </p>
              {myConn.diversityWarning && (
                <p className={styles.diversityWarning}>{myConn.diversityWarning}</p>
              )}
            </section>
          )}
        </div>
      )}

      {/* Share modal */}
      {showShare && myPlayer && (
        <ShareModal
          player={myPlayer}
          rank={myRank || undefined}
          totalPlayers={sorted.length}
          formResults={formResults}
          topRival={topRival ? { name: topRival.playerB.name, wins: topRival.wins, losses: topRival.losses } : undefined}
          winRate={myWinRate}
          onClose={() => setShowShare(false)}
        />
      )}

      {/* Attestation detail modal */}
      {detailAtt && (
        <AttestationDetailModal
          attestation={detailAtt}
          replayData={data}
          onClose={() => setDetailAtt(null)}
          onConfirm={async () => {
            try {
              await api.post(`/attestations/${detailAtt.id}/confirm`);
              await refetchAtt();
              refetchPendingCounts();
              showToast(t("Round confirmed — rating updated"), "success");
            } catch {
              showToast(t("Failed to confirm round"), "error");
            }
          }}
          onDispute={async (participants) => {
            try {
              await api.post(`/attestations/${detailAtt.id}/dispute`, { participants });
              await refetchAtt();
              refetchPendingCounts();
              showToast(t("Dispute sent back for confirmation"), "success");
            } catch {
              showToast(t("Failed to send dispute"), "error");
            }
          }}
        />
      )}
    </div>
  );
}
