import { useReplay, useRounds, useAttestations } from "@/hooks/useData";
import { t } from "@/lib/i18n";
import { useMatchSuggestions } from "@/hooks/useAI";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import PlayerCard from "@/components/PlayerCard";
import RoundCard from "@/components/RoundCard";
import MathsOverlay from "@/components/MathsOverlay";
import RivalryCard from "@/components/RivalryCard";
import FormStrip from "@/components/FormStrip";
import ShareModal from "@/components/ShareModal";
import InviteModal from "@/components/InviteModal";
import { SkeletonCard, SkeletonList } from "@/components/Skeleton";
import { useCountUp } from "@/hooks/useCountUp";
import TierBadge from "@/components/TierBadge";
import { buildRivalries } from "@/lib/rivalries";
import { useFriends } from "@/hooks/useData";
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import styles from "./OverviewPage.module.css";

interface CurvePoint {
  r: number;
  d: string | null;
  label: string;
}

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

function Sparkline({ curve }: { curve: CurvePoint[] }) {
  if (curve.length < 2) return null;

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [plotW, setPlotW] = useState(520);

  // Chart dimensions — responsive width, fixed height
  const margin = { top: 24, right: 48, bottom: 32, left: 48 };
  const plotH = 240;
  const svgW = plotW + margin.left + margin.right;
  const svgH = plotH + margin.top + margin.bottom;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const update = () => {
      const width = el.getBoundingClientRect().width;
      // Fill the container width, but keep a sensible minimum for readability
      setPlotW(Math.max(280, Math.floor(width - margin.left - margin.right)));
    };

    update();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(el);
    } else {
      window.addEventListener("resize", update);
    }

    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", update);
    };
  }, []);

  const vals = curve.map((c) => c.r);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const step = plotW / (curve.length - 1);
  const scaleY = (v: number) => margin.top + plotH - ((v - min) / range) * plotH;

  const points = useMemo(() =>
    vals.map((v, i) => {
      const x = margin.left + i * step;
      const y = scaleY(v);
      return { x, y, v, i };
    }),
    [vals, step]
  );

  // Gridlines — 3 horizontal
  const gridlines = [min, (min + max) / 2, max];

  const path = useMemo(
    () => `M ${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ")}`,
    [points]
  );

  const baselineY = scaleY(min);
  const areaPath = `${path} L ${margin.left + plotW.toFixed(1)},${baselineY} L ${margin.left},${baselineY} Z`;

  const updateIndexFromClientX = useCallback((clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = Math.max(margin.left, Math.min(margin.left + plotW, ((clientX - rect.left) / rect.width) * svgW));
    const idx = Math.round((x - margin.left) / step);
    setActiveIndex(Math.max(0, Math.min(curve.length - 1, idx)));
  }, [curve.length, plotW, step, svgW]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => { updateIndexFromClientX(e.clientX); },
    [updateIndexFromClientX]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => { setIsDragging(true); updateIndexFromClientX(e.clientX); },
    [updateIndexFromClientX]
  );

  const handleMouseUp = useCallback(() => { setIsDragging(false); }, []);
  const handleMouseLeave = useCallback(() => { if (!isDragging) setActiveIndex(null); }, [isDragging]);

  const activeIndexSafe = activeIndex == null ? -1 : activeIndex;
  const active = activeIndexSafe >= 0 ? points[activeIndexSafe] : null;
  const activePoint = activeIndexSafe >= 0 ? curve[activeIndexSafe] : null;

  return (
    <div ref={wrapRef} className={styles.chartWrap}>
      <div
        className={styles.chartArea}
        data-active={!!active}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <svg
          ref={svgRef}
          className={styles.ratingChart}
          viewBox={`0 0 ${svgW} ${svgH}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Gridlines */}
          {gridlines.map((val, i) => {
            const y = scaleY(val);
            return (
              <g key={i}>
                <line
                  x1={margin.left}
                  y1={y}
                  x2={margin.left + plotW}
                  y2={y}
                  stroke="var(--rule-light)"
                  strokeWidth="1"
                />
                <text
                  x={margin.left - 6}
                  y={y + 5}
                  textAnchor="end"
                  fill="var(--ink-2)"
                  fontFamily="var(--font-mono)"
                  fontSize="16"
                  fontWeight={400}
                >
                  {Math.round(val)}
                </text>
              </g>
            );
          })}

          {/* Baseline */}
          <line
            x1={margin.left}
            y1={baselineY}
            x2={margin.left + plotW}
            y2={baselineY}
            stroke="var(--rule)"
            strokeWidth="1"
          />

          {/* Area fill */}
          <path d={areaPath} fill="var(--green)" fillOpacity="0.08" stroke="none" />

          {/* Line — 2px brand green */}
          <path d={path} fill="none" stroke="var(--green)" strokeWidth="2" />

          {/* Crosshair */}
          {active && (
            <line
              x1={active.x}
              y1={margin.top}
              x2={active.x}
              y2={margin.top + plotH}
              stroke="var(--brass)"
              strokeWidth="1.5"
              strokeDasharray="3 2"
            />
          )}

          {/* Cursor dot */}
          {active && (
            <circle
              cx={active.x}
              cy={active.y}
              r="4"
              fill="var(--brass)"
              stroke="var(--math-bg)"
              strokeWidth="2"
            />
          )}

          {/* Time axis labels — first and last */}
          <text
            x={margin.left}
            y={margin.top + plotH + 20}
            textAnchor="start"
            fill="var(--ink-2)"
            fontFamily="var(--font-mono)"
            fontSize="12"
            fontWeight={400}
          >
            {curve[0].d || ""}
          </text>
          <text
            x={margin.left + plotW}
            y={margin.top + plotH + 20}
            textAnchor="end"
            fill="var(--ink-2)"
            fontFamily="var(--font-mono)"
            fontSize="12"
            fontWeight={400}
          >
            {curve[curve.length - 1].d || ""}
          </text>
        </svg>

        {/* Hover tooltip */}
        {activePoint && (
          <div className={styles.chartTooltip} data-visible={!!active}>
            <span className={styles.tooltipDate}>{activePoint.d}</span>
            <span className={styles.tooltipLabel}>{activePoint.label}</span>
            <span className={styles.tooltipRating}>{Math.round(activePoint.r)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const { user } = useAuth();
  const { data, loading } = useReplay();
  const { rounds } = useRounds();
  const { attestations } = useAttestations();
  const { friends } = useFriends();
  const { suggestions, loading: suggestionsLoading } = useMatchSuggestions();
  const [mathsRound, setMathsRound] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [inviteSuggestion, setInviteSuggestion] = useState<{ playerId: string; playerName: string } | null>(null);

  // All hooks must be called before any early return
  const rivalries = useMemo(
    () => (data && user ? buildRivalries(data, user.id) : []),
    [data, user]
  );

  // Compute form results for current user
  const myFormResults = useMemo(() => {
    if (!data || !user) return [];
    return computeFormResults(user.id, data.rounds);
  }, [data, user]);

  // Compute form results for each player
  const playerFormResults = useMemo(() => {
    if (!data) return new Map<string, FormResult[]>();
    const map = new Map<string, FormResult[]>();
    for (const p of data.players) {
      map.set(p.id, computeFormResults(p.id, data.rounds));
    }
    return map;
  }, [data]);

  const rawRating = user && data ? data.players.find((p) => p.id === user.id)?.rating ?? 0 : 0;
  const animatedRating = useCountUp(rawRating);

  if (loading) {
    return (
      <div className={styles.loading}>
        <SkeletonCard />
        <SkeletonList count={2} />
      </div>
    );
  }

  if (!data || data.players.length === 0) {
    const hasFriends = friends.length > 0;
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIllustration}>
          <span className={styles.emptyIcon}>◐</span>
        </div>
        <p className={styles.emptyTitle}>{t("Your golf network is empty")}</p>
        <p className={styles.emptySub}>
          {hasFriends
            ? t("Log a round with your friends to start seeing ratings.")
            : t("Find your golf buddies to get started.")}
        </p>
        {!hasFriends && (
          <Link to="/friends" className={styles.emptyAction}>
            {t("Find Players →")}
          </Link>
        )}
        <Link to="/log" className={styles.emptyLink}>
          {t("Log a Round →")}
        </Link>
      </div>
    );
  }

  const sorted = [...data.players].filter((p) => !p.isPro).sort((a, b) => b.rating - a.rating);
  const top3 = sorted.slice(0, 3);
  const recentRounds = data.rounds.slice(-5).reverse();
  const pendingCount = attestations.filter((a) => a.status === "pending").length;

  // Current user's stats
  const myPlayer = user ? data.players.find((p) => p.id === user.id) : null;
  const myRank = myPlayer ? sorted.findIndex((p) => p.id === myPlayer.id) + 1 : null;
  const myDelta = myPlayer && myPlayer.curve.length > 1
    ? myPlayer.rating - myPlayer.curve[0].r
    : 0;
  const myWins = myPlayer && data
    ? data.rounds.filter((r) => {
        const snap = r.snapshot.find((s) => s.playerId === myPlayer.id);
        return snap && snap.delta > 0;
      }).length
    : 0;
  const myTotalRounds = myPlayer?.matches ?? 0;
  const myLastRound = myPlayer?.curve.length
    ? myPlayer.curve[myPlayer.curve.length - 1]
    : null;

  const confidenceLabel = myPlayer
    ? myPlayer.rd > 120 ? t("Low") : myPlayer.rd >= 60 ? t("Medium") : t("High")
    : "—";

  const selectedRound = mathsRound
    ? data.rounds.find((r) => r.id === mathsRound) ?? null
    : null;

  // Win rate
  const myLosses = myPlayer && data
    ? data.rounds.filter((r) => {
        const snap = r.snapshot.find((s) => s.playerId === myPlayer.id);
        return snap && snap.delta < 0;
      }).length
    : 0;
  const myWinRate = myTotalRounds > 0
    ? Math.round((myWins / myTotalRounds) * 100)
    : 0;

  const topRival = rivalries.length > 0 ? rivalries[0] : null;

  return (
    <div className={styles.page}>
      {/* My Stats hero */}
      {myPlayer && (
        <section className={styles.sectionCard}>
          <div className={styles.heroSection}>
          <div className={styles.heroTop}>
            <div className={styles.heroLeft}>
              <div className={styles.heroLabel}>
                {t("Your Rating")}
                {myRank && <TierBadge rankIndex={myRank - 1} total={sorted.length} />}
              </div>
              <div className={styles.heroRatingRow}>
                <div className={styles.heroRating}>
                  {Math.round(animatedRating)}
                </div>
              </div>
              <div className={`${styles.heroDelta} ${myDelta > 0 ? styles.pos : myDelta < 0 ? styles.neg : ""}`}>
                {myDelta > 0 ? "▲ +" : myDelta < 0 ? "▼ −" : "→ "}{t("{n} since your first round", { n: Math.abs(Math.round(myDelta)) })}
              </div>
              {myFormResults.length > 0 && (
                <div className={styles.heroFormStrip}>
                  <FormStrip results={myFormResults} showLabel />
                </div>
              )}
              {myPlayer.isProvisional && (
                <div className={styles.provisional}>{t("New player — still settling")}</div>
              )}
            </div>
            <div className={styles.heroRight}>
              {myRank && (
                <div className={styles.rankBadge} title={t("You are ranked #{rank} among {n} players", { rank: myRank, n: sorted.length })}>
                  <span className={styles.rankLabel}>{t("RANK")}</span>
                  <span className={styles.rankNum}>#{myRank}</span>
                  <span className={styles.rankTotal}>{t("of {n}", { n: sorted.length })}</span>
                </div>
              )}
            </div>
          </div>

          <button className={styles.shareBtn} onClick={() => setShowShare(true)}>
            {t("Share Rating")}
          </button>

          {myPlayer.curve.length > 1 && <Sparkline curve={myPlayer.curve} />}

          <div className={styles.statGrid}>
            <div className={styles.statTile}>
              <span className={styles.statVal}>
                {myPlayer.hcpIndex != null ? myPlayer.hcpIndex.toFixed(1) : "—"}
              </span>
              <span className={styles.statLabel}>{t("Handicap")}</span>
            </div>
            <div className={styles.statTile}>
              <span className={styles.statVal}>
                {myPlayer.daysIdle < 999 ? t("{n} days ago", { n: myPlayer.daysIdle }) : "—"}
              </span>
              <span className={styles.statLabel}>{t("Last played")}</span>
            </div>
            <div className={styles.statTile}>
              <span className={styles.statVal}>{myTotalRounds}</span>
              <span className={styles.statLabel}>{t("Rounds")}</span>
            </div>
            <div className={styles.statTile}>
              <span className={styles.statVal}>{confidenceLabel}</span>
              <span className={styles.statLabel}>{t("Confidence")}</span>
            </div>
          </div>
          </div>
        </section>
      )}

      {/* Pending attestations banner */}
      {pendingCount > 0 && (
        <div className={styles.banner}>
          {t("You have {n} rounds to confirm", { n: pendingCount })}
        </div>
      )}

      {/* Rivalry card (most-played opponent) */}
      {rivalries.length > 0 && (
        <section className={styles.sectionCard}>
          <h2 className={styles.sectionTitle}>{t("Your Rival")}</h2>
          <RivalryCard rivalries={rivalries} variant="compact" />
        </section>
      )}

      {/* Top 3 summary */}
      <section className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>{t("Top Form")}</h2>
        {top3.map((p, i) => (
          <PlayerCard
            key={p.id}
            player={p}
            rank={i + 1}
            totalPlayers={sorted.length}
            formResults={playerFormResults.get(p.id)}
            isYou={p.id === user?.id}
          />
        ))}
      </section>

      {/* Matchmaking — Who to play next */}
      {suggestions.length > 0 && !suggestionsLoading && (
        <section className={styles.sectionCard}>
          <h2 className={styles.sectionTitle}>{t("Who to play next")}</h2>
          <div className={styles.matchList}>
            {suggestions.slice(0, 3).map((s) => (
              <div key={s.playerId} className={styles.matchCard}>
                <div className={styles.matchInfo}>
                  <Link
                    to={`/player/${s.playerId}`}
                    className={styles.matchName}
                  >
                    {s.playerName}
                  </Link>
                  <span className={styles.matchRating}>{t("Rating {n}", { n: s.rating })}</span>
                </div>
                <p className={styles.matchReason}>{s.reason}</p>
                <button
                  className={styles.matchInvite}
                  onClick={() => setInviteSuggestion({ playerId: s.playerId, playerName: s.playerName })}
                >
                  {t("Invite →")}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent activity */}
      {recentRounds.length > 0 && (
        <section className={styles.sectionCard}>
          <h2 className={styles.sectionTitle}>{t("Recent Rounds")}</h2>
          {recentRounds.map((r) => (
            <RoundCard
              key={r.id}
              round={r}
              players={data.players}
              onToggleMaths={() =>
                setMathsRound(mathsRound === r.id ? null : r.id)
              }
            />
          ))}
        </section>
      )}

      {/* "Show the maths" overlay */}
      {selectedRound && (
        <MathsOverlay
          round={selectedRound}
          players={data.players}
          onClose={() => setMathsRound(null)}
        />
      )}

      {/* Share modal */}
      {showShare && myPlayer && (
        <ShareModal
          player={myPlayer}
          rank={myRank || undefined}
          totalPlayers={sorted.length}
          formResults={myFormResults}
          topRival={topRival ? { name: topRival.playerB.name, wins: topRival.wins, losses: topRival.losses } : undefined}
          winRate={myWinRate}
          onClose={() => setShowShare(false)}
        />
      )}

      {/* Invite modal */}
      {inviteSuggestion && (
        <InviteModal
          playerId={inviteSuggestion.playerId}
          playerName={inviteSuggestion.playerName}
          senderName={user?.displayName || t("I")}
          onClose={() => setInviteSuggestion(null)}
        />
      )}
    </div>
  );
}
