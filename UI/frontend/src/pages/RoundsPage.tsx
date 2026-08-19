import { useReplay } from "@/hooks/useData";
import { t } from "@/lib/i18n";
import { Link } from "react-router-dom";
import RoundTimeline from "@/components/RoundTimeline";
import MathsOverlay from "@/components/MathsOverlay";
import { useState } from "react";
import { SkeletonList } from "@/components/Skeleton";
import styles from "./RoundsPage.module.css";

export default function RoundsPage() {
  const { data, loading } = useReplay();
  const [mathsRound, setMathsRound] = useState<string | null>(null);

  if (loading) {
    return (
      <div className={styles.loading}>
        <SkeletonList count={4} withAvatar={false} />
      </div>
    );
  }

  if (!data || data.rounds.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>◷</div>
        <p className={styles.emptyTitle}>{t("No rounds yet")}</p>
        <p className={styles.emptySub}>{t("Log your first round to start tracking ratings.")}</p>
        <Link to="/log" className={styles.emptyLink}>{t("Log a Round →")}</Link>
      </div>
    );
  }

  const rounds = [...data.rounds].reverse();
  const selectedRound = mathsRound
    ? data.rounds.find((r) => r.id === mathsRound) ?? null
    : null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.title}>{t("Rounds")}</h2>
        <span className={styles.count}>{t("{n} total", { n: rounds.length })}</span>
      </div>
      <div className={styles.timeline}>
        {rounds.map((r) => (
          <RoundTimeline
            key={r.id}
            round={r}
            players={data.players}
            onToggleMaths={() =>
              setMathsRound(mathsRound === r.id ? null : r.id)
            }
          />
        ))}
      </div>

      {selectedRound && (
        <MathsOverlay
          round={selectedRound}
          players={data.players}
          onClose={() => setMathsRound(null)}
        />
      )}
    </div>
  );
}
