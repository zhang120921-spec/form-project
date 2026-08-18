import { useState } from "react";
import type { RivalryRecord } from "@/lib/rivalries";
import { rivalryToText } from "@/lib/rivalries";
import styles from "./RivalryCard.module.css";
import { t } from "@/lib/i18n";

interface Props {
  rivalries: RivalryRecord[];
  /** Compact mode for overview; full mode for profile. */
  variant?: "compact" | "full";
}

export default function RivalryCard({ rivalries, variant = "compact" }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (rivalries.length === 0) {
    if (variant === "compact") return null;
    return (
      <div className={styles.empty}>
        <p>{t("No rivalries yet — log at least three rounds with the same opponent to build a record.")}</p>
      </div>
    );
  }

  const handleShare = async (r: RivalryRecord) => {
    const text = rivalryToText(r);
    if (navigator.share) {
      try { await navigator.share({ text }); } catch { /* cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch { /* ignore */ }
    }
  };

  // Compact: show only the most-played rivalry
  const display = variant === "compact" ? rivalries.slice(0, 1) : rivalries;

  return (
    <div className={styles.container}>
      {variant === "compact" ? null : (
        <h3 className={styles.heading}>{t("Your Rival")}</h3>
      )}

      {display.map((r) => {
        const isExpanded = expanded === r.playerB.id;
        const last5 = r.meetings.slice(-5).reverse();
        const streakText =
          r.currentStreak > 0
            ? t("{n}-match winning streak", { n: r.currentStreak })
            : r.currentStreak < 0
              ? t("{n}-match losing streak", { n: -r.currentStreak })
              : t("even streak");
        const edge = Math.abs(r.predictedEdge);
        const edgeN = Math.round(edge);
        const strokeWord = edgeN === 1 ? t("stroke") : t("strokes");
        const edgeText =
          edge < 0.5
            ? t("dead even on current form")
            : r.aIsFavoured
              ? t("you'd expect to beat {name} by ~{n} {strokeWord}", { name: r.playerB.name, n: edgeN, strokeWord })
              : t("{name} favoured by ~{n} {strokeWord}", { name: r.playerB.name, n: edgeN, strokeWord });

        return (
          <div key={r.playerB.id} className={styles.rivalryItem}>
            <button
              type="button"
              className={styles.headerRow}
              onClick={() => setExpanded(isExpanded ? null : r.playerB.id)}
              aria-expanded={variant === "full" ? isExpanded : undefined}
            >
              <div className={styles.headerLeft}>
                <span className={styles.oppName}>{r.playerB.name}</span>
                <span className={styles.record}>
                  <span className={r.wins > r.losses ? styles.recordWin : r.wins < r.losses ? styles.recordLoss : ""}>
                    {r.wins}–{r.losses}
                  </span>
                </span>
              </div>
              <div className={styles.headerRight}>
                <span className={styles.streakBadge}>
                  {r.currentStreak > 0 ? "▲" : r.currentStreak < 0 ? "▼" : "→"} {streakText}
                </span>
                <span className={styles.meetings}>{t("{n} meetings", { n: r.meetings.length })}</span>
              </div>
            </button>

            <p className={styles.edgeLine}>{edgeText}.</p>

            {variant === "full" && isExpanded && (
              <div className={styles.detail}>
                <div className={styles.detailGrid}>
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>{t("Longest win streak")}</span>
                    <span className={styles.detailVal}>{r.longestWinStreak}</span>
                  </div>
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>{t("Longest losing streak")}</span>
                    <span className={styles.detailVal}>{r.longestLossStreak}</span>
                  </div>
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>{t("Biggest margin")}</span>
                    <span className={styles.detailVal}>
                      {r.biggestMargin.toFixed(1)} {t("strokes")}
                    </span>
                  </div>
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>{t("Aggregate margin")}</span>
                    <span className={`${styles.detailVal} ${r.aggregateMargin > 0 ? styles.pos : r.aggregateMargin < 0 ? styles.neg : ""}`}>
                      {r.aggregateMargin > 0 ? "+" : r.aggregateMargin < 0 ? "−" : ""}{Math.abs(r.aggregateMargin).toFixed(1)}
                    </span>
                  </div>
                </div>

                <h4 className={styles.lastTitle}>{t("Last 5 meetings")}</h4>
                <div className={styles.meetingList}>
                  {last5.map((m, i) => (
                    <div key={i} className={styles.meetingItem}>
                      <span className={styles.meetingDate}>{m.date}</span>
                      <span className={styles.meetingCourse}>{m.course}</span>
                      <span className={`${styles.meetingResult} ${m.winner === "A" ? styles.pos : styles.neg}`}>
                        {m.winner === "A" ? "W" : "L"} {Math.abs(m.margin).toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>

                <button className={styles.shareBtn} onClick={() => handleShare(r)}>
                  {copied ? t("Copied") : t("Share")}
                </button>
              </div>
            )}

            {variant === "full" && (
              <button
                className={styles.expandBtn}
                onClick={() => setExpanded(isExpanded ? null : r.playerB.id)}
              >
                {isExpanded ? t("Hide details") : t("Show details")}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
