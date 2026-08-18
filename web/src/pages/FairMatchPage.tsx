import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useReplay, useCourses, useRounds } from "@/hooks/useData";
import { usePublicProfiles } from "@/hooks/useAI";
import { useAuth } from "@/hooks/useAuth";
import { computeFairMatch, phraseMatch, type MatchFormat } from "@/lib/fair-match";
import type { PlayerState, Course, Tee, RoundRecord } from "@/lib/types";
import { t } from "@/lib/i18n";
import styles from "./FairMatchPage.module.css";

const FORMATS: { value: MatchFormat; label: string }[] = [
  { value: "stroke", label: "Stroke" },
  { value: "stableford", label: "Stableford" },
  { value: "match", label: "Match play" },
];

const HOLES = [18, 9] as const;

export default function FairMatchPage() {
  const [tab, setTab] = useState<"match" | "pros">("match");

  return (
    <div className={styles.page}>
      <div className={styles.tabBar}>
        <button
          className={`${styles.tab} ${tab === "match" ? styles.tabActive : ""}`}
          onClick={() => setTab("match")}
        >
          {t("Fair Match")}
        </button>
        <button
          className={`${styles.tab} ${tab === "pros" ? styles.tabActive : ""}`}
          onClick={() => setTab("pros")}
        >
          {t("Compare to Pros")}
        </button>
      </div>

      {tab === "match" ? <FairMatchCalculator /> : <CompareToPros />}
    </div>
  );
}

function FairMatchCalculator() {
  const { data: replay, loading: replayLoading } = useReplay();
  const { rounds, loading: roundsLoading } = useRounds();
  const { courses } = useCourses();
  const { user } = useAuth();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [courseId, setCourseId] = useState("");
  const [teeIdx, setTeeIdx] = useState(0);
  const [format, setFormat] = useState<MatchFormat>("stroke");
  const [holes, setHoles] = useState<number>(18);
  const [strokeOverride, setStrokeOverride] = useState<number | null>(null);

  const userId = user?.id;

  // Only show players the engine has actually processed through the user's
  // confirmed rounds. No hardcoded examples, no seeded strangers.
  const eligiblePlayerIds = useMemo(() => {
    const ids = new Set<string>();
    if (userId) ids.add(userId);

    const confirmedUserRounds = rounds.filter(
      (r): r is RoundRecord & { status: "confirmed"; participants: { playerId: string }[] } =>
        r.status === "confirmed" &&
        Array.isArray(r.participants) &&
        r.participants.some((p: unknown) => {
          const participant = p as { playerId?: string };
          return participant?.playerId === userId;
        })
    );

    for (const r of confirmedUserRounds) {
      for (const p of r.participants) {
        if (p.playerId) ids.add(p.playerId);
      }
    }

    return ids;
  }, [rounds, userId]);

  const players: PlayerState[] = useMemo(
    () => (replay?.players ?? []).filter((p) => eligiblePlayerIds.has(p.id) && !p.isPro),
    [replay?.players, eligiblePlayerIds]
  );

  const selectedCourse = courses.find((c) => c.id === courseId);
  const selectedTee: Tee | undefined = selectedCourse?.tees?.[teeIdx];

  const selectedPlayers = useMemo(
    () => players.filter((p) => selectedIds.includes(p.id)),
    [players, selectedIds]
  );

  const result = useMemo(() => {
    if (selectedPlayers.length < 2 || !selectedTee) return null;
    try {
      return computeFairMatch(
        selectedPlayers.map((p) => ({ id: p.id, name: p.name, rating: p.rating })),
        format,
        holes
      );
    } catch {
      return null;
    }
  }, [selectedPlayers, selectedTee, format, holes]);

  // Reset override when inputs change
  const baseStrokes = result?.recommendedStrokes ?? 0;
  const effectiveOverride =
    strokeOverride != null ? strokeOverride : Math.round(baseStrokes);

  const displayResult = useMemo(() => {
    if (selectedPlayers.length < 2 || !selectedTee) return null;
    try {
      return computeFairMatch(
        selectedPlayers.map((p) => ({ id: p.id, name: p.name, rating: p.rating })),
        format,
        holes,
        undefined,
        strokeOverride
      );
    } catch {
      return null;
    }
  }, [selectedPlayers, selectedTee, format, holes, strokeOverride]);

  const phrase = displayResult && selectedTee
    ? phraseMatch(displayResult, selectedTee.name, selectedCourse?.name ?? "")
    : "";

  const togglePlayer = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id)
        ? prev.filter((p) => p !== id)
        : prev.length < 4
          ? [...prev, id]
          : prev
    );
    setStrokeOverride(null);
  };

  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  const handleShare = async () => {
    if (!phrase) return;
    if (canShare) {
      try { await navigator.share({ text: phrase }); } catch { /* cancelled */ }
    } else {
      try { await navigator.clipboard.writeText(phrase); } catch { /* ignore */ }
    }
  };

  if (replayLoading || roundsLoading) {
    return <p className={styles.empty}>{t("Loading ratings…")}</p>;
  }

  return (
    <>
      {/* ── Player selection ── */}
      <section className={styles.section}>
        <h2 className={styles.heading}>{t("Fair-Match Calculator")}</h2>
        <p className={styles.lede}>
          {t("What strokes should we play off? Pick two to four players from your confirmed rounds and let the rating do the maths.")}
        </p>

        {players.length < 2 ? (
          <p className={styles.empty}>
            {t("Log and confirm a round with at least one other player to see Fair-Match options here. Only players from your confirmed rounds appear.")}
          </p>
        ) : (
          <>
            <div className={styles.playerGrid}>
              {players.map((p) => {
                const selected = selectedIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    className={`${styles.playerChip} ${selected ? styles.chipActive : ""}`}
                    onClick={() => togglePlayer(p.id)}
                  >
                    <span className={styles.chipName}>{p.name}</span>
                    <span className={styles.chipRating}>{Math.round(p.rating)}</span>
                    {p.isProvisional && <span className={styles.chipProv}>{t("prov.")}</span>}
                  </button>
                );
              })}
            </div>
            <p className={styles.count}>
              {t("{n} / 4 selected", { n: selectedIds.length })}
              {selectedIds.length < 2 && ` ${t("— pick at least two")}`}
            </p>
          </>
        )}
      </section>

      {/* ── Course & format ── */}
      {selectedIds.length >= 2 && (
        <section className={styles.section}>
          <h3 className={styles.subHeading}>{t("Course & format")}</h3>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t("Course")}</span>
            <select
              className={styles.select}
              value={courseId}
              onChange={(e) => { setCourseId(e.target.value); setTeeIdx(0); setStrokeOverride(null); }}
            >
              <option value="">{t("Select a course…")}</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          {selectedCourse && (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t("Tee")}</span>
              <select
                className={styles.select}
                value={teeIdx}
                onChange={(e) => { setTeeIdx(Number(e.target.value)); setStrokeOverride(null); }}
              >
                {selectedCourse.tees?.map((tee, i) => (
                  <option key={i} value={i}>
                    {t("{name} — Par {par}, CR {cr}, Slope {slope}", {
                      name: tee.name,
                      par: tee.par,
                      cr: tee.cr,
                      slope: tee.slope,
                    })}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className={styles.row}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t("Format")}</span>
              <select
                className={styles.select}
                value={format}
                onChange={(e) => { setFormat(e.target.value as MatchFormat); setStrokeOverride(null); }}
              >
                {FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>{t(f.label)}</option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t("Holes")}</span>
              <select
                className={styles.select}
                value={holes}
                onChange={(e) => { setHoles(Number(e.target.value)); setStrokeOverride(null); }}
              >
                {HOLES.map((h) => (
                  <option key={h} value={h}>{t("{n} holes", { n: h })}</option>
                ))}
              </select>
            </label>
          </div>
        </section>
      )}

      {/* ── Results ── */}
      {displayResult && selectedTee && (
        <section className={styles.section}>
          <h3 className={styles.subHeading}>{t("Stroke allocation")}</h3>

          {/* Nudge controls */}
          <div className={styles.nudgeRow}>
            <button
              className={styles.nudgeBtn}
              onClick={() => setStrokeOverride(Math.max(0, effectiveOverride - 1))}
            >
              −
            </button>
            <div className={styles.nudgeCenter}>
              <span className={styles.nudgeStrokes}>{effectiveOverride}</span>
              <span className={styles.nudgeLabel}>
                {effectiveOverride === 0 ? t("even") : effectiveOverride === 1 ? t("stroke") : t("strokes")}
              </span>
            </div>
            <button
              className={styles.nudgeBtn}
              onClick={() => setStrokeOverride(effectiveOverride + 1)}
            >
              +
            </button>
          </div>

          {/* Residual — shown honestly */}
          <p className={styles.residual}>
            {Math.abs(displayResult.residual) < 0.005
              ? t("Even split — this is a fair match.")
              : displayResult.residual > 0
                ? t("Giving {strokes} leaves the receiver at {pct}% — the exact figure is {exact}.", {
                    strokes: effectiveOverride,
                    pct: (displayResult.players[displayResult.players.length - 1].winProb * 100).toFixed(1),
                    exact: displayResult.recommendedStrokes.toFixed(1),
                  })
                : t("Giving {strokes} over-gifts by {n} strokes.", {
                    strokes: effectiveOverride,
                    n: Math.abs(displayResult.residual).toFixed(1),
                  })}
          </p>

          {/* Per-player table */}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>{t("Player")}</th>
                  <th className={styles.thNum}>{t("Rating")}</th>
                  <th className={styles.thNum}>{t("Strokes")}</th>
                  <th className={styles.thNum}>{t("Win prob")}</th>
                </tr>
              </thead>
              <tbody>
                {displayResult.players.map((p) => {
                  const pct = p.winProb * 100;
                  const delta = p.winProb - 0.5;
                  const cls = delta > 0.001 ? styles.pos : delta < -0.001 ? styles.neg : "";
                  const arrow = delta > 0.001 ? "▲" : delta < -0.001 ? "▼" : "→";
                  const sign = delta > 0.001 ? "+" : delta < -0.001 ? "−" : "";
                  return (
                  <tr key={p.playerId} className={cls}>
                    <td className={styles.td}>
                      <Link to={`/player/${p.playerId}`} className={styles.playerLink}>
                        {p.name}
                      </Link>
                    </td>
                    <td className={styles.tdNum}>{Math.round(p.rating)}</td>
                    <td className={styles.tdNum}>
                      {p.strokesReceived > 0 ? `+${p.strokesReceived}` : "—"}
                    </td>
                    <td className={styles.tdNum}>
                      {pct.toFixed(1)}%
                      <span className={styles.deltaInline}>
                        {arrow} {sign}{Math.abs((delta * 100)).toFixed(1)}
                      </span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Conversational phrasing */}
          <div className={styles.phraseBox}>
            <p className={styles.phrase}>{phrase}</p>
            <button className={styles.shareBtn} onClick={handleShare}>
              {canShare ? t("Share") : t("Copy")}
            </button>
          </div>

          {/* Divisor provenance */}
          <p className={styles.provenance}>
            {t("Divisor: {divisor} pts/stroke", { divisor: displayResult.divisor.toFixed(1) })}
            {" "}{t("— derived from live α, not hardcoded.")}
          </p>
        </section>
      )}
    </>
  );
}

function CompareToPros() {
  const { profiles: pros, loading, error } = usePublicProfiles("pro");
  const { data } = useReplay();
  const { user } = useAuth();

  const myPlayer = user && data
    ? data.players.find((p) => p.id === user.id)
    : null;
  const myRating = myPlayer?.rating ?? null;

  const sortedPros = useMemo(
    () => [...pros].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)),
    [pros]
  );

  if (loading) {
    return <p className={styles.empty}>{t("Loading pro players…")}</p>;
  }

  if (error) {
    return <p className={styles.empty}>{error}</p>;
  }

  if (pros.length === 0) {
    return (
      <p className={styles.empty}>{t("No pro data available yet.")}</p>
    );
  }

  return (
    <>
      {myRating != null && (
        <section className={styles.section}>
          <div className={styles.yourRatingBanner}>
            <span className={styles.bannerLabel}>{t("Your Rating")}</span>
            <span className={styles.bannerNum}>{Math.round(myRating)}</span>
          </div>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.heading}>{t("How you stack up")}</h2>
        <p className={styles.lede}>
          {t("The rating gap between you and each tour pro. A larger gap means more strokes to make it fair.")}
        </p>

        <div className={styles.proList}>
          {sortedPros.map((p) => {
            const gap = myRating != null && p.rating != null
              ? Math.round(p.rating - myRating)
              : null;
            return (
              <Link
                key={p.id}
                to={`/player/${p.id}`}
                className={styles.proRow}
              >
                <div className={styles.proInfo}>
                  <span className={styles.proName}>{p.displayName}</span>
                  <span className={styles.proMeta}>
                    {[p.homeClub, p.region].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <div className={styles.proStats}>
                  <span className={styles.proRating}>
                    {p.rating != null ? Math.round(p.rating) : "—"}
                  </span>
                  {gap != null && (
                    <span className={`${styles.proGap} ${gap > 0 ? styles.gapAbove : gap < 0 ? styles.gapBelow : ""}`}>
                      {gap > 0 ? `+${gap}` : gap === 0 ? t("even") : gap}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </>
  );
}
