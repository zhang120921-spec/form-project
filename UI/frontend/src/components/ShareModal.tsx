import { useState } from "react";
import type { PlayerState } from "@engine/index.ts";
import FormStrip from "./FormStrip";
import { t } from "@/lib/i18n";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import styles from "./ShareModal.module.css";

type FormResult = "W" | "L" | "T";

interface Props {
  player: PlayerState;
  rank?: number;
  totalPlayers?: number;
  formResults: FormResult[];
  topRival?: { name: string; wins: number; losses: number };
  winRate: number;
  onClose: () => void;
}

export default function ShareModal({
  player,
  rank,
  totalPlayers = 10,
  formResults,
  topRival,
  winRate,
  onClose,
}: Props) {
  const [copiedText, setCopiedText] = useState(false);

  useEscapeKey(onClose);

  const handleCopyText = async () => {
    const parts = [t("My FORM rating is {rating}", { rating: Math.round(player.rating) })];
    parts.push(`. ${t("I've played {rounds} rounds with a {winRate}% win rate.", { rounds: player.matches, winRate })}`);
    if (topRival) {
      parts.push(` ${t("Top rival: {name} ({wins}-{losses}).", { name: topRival.name, wins: topRival.wins, losses: topRival.losses })}`);
    }
    parts.push(" form.golf");

    const text = parts.join("");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    } catch {}
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
      >
        <div className={styles.modalHeader}>
          <h3 id="share-modal-title" className={styles.modalTitle}>{t("Share Your Rating")}</h3>
          <button className={styles.closeBtn} onClick={onClose} aria-label={t("Close")}>✕</button>
        </div>

        {/* Share card preview */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardLogo}>FORM</span>
            <span className={styles.cardTagline}>{t("Know where you stand")}</span>
          </div>

          <div className={styles.cardNameRow}>
            <span className={styles.cardName}>{player.name}</span>
            {rank && <span className={styles.cardRank}>#{rank}</span>}
          </div>

          <div className={styles.cardHero}>
            <span className={styles.cardRating}>{Math.round(player.rating)}</span>
            <span className={styles.cardRatingLabel}>{t("FORM rating")}</span>
          </div>

          {formResults.length > 0 && (
            <div className={styles.cardFormRow}>
              <FormStrip results={formResults} showLabel />
            </div>
          )}

          <div className={styles.cardStats}>
            <div className={styles.cardStat}>
              <span className={styles.cardStatVal}>{player.matches}</span>
              <span className={styles.cardStatLabel}>{t("Rounds")}</span>
            </div>
            <div className={styles.cardStat}>
              <span className={styles.cardStatVal}>{winRate}%</span>
              <span className={styles.cardStatLabel}>{t("Win Rate")}</span>
            </div>
            {topRival && (
              <div className={styles.cardStat}>
                <span className={styles.cardStatVal}>{topRival.wins}–{topRival.losses}</span>
                <span className={styles.cardStatLabel}>{t("vs {name}", { name: topRival.name })}</span>
              </div>
            )}
          </div>
        </div>

        <p className={styles.note}>{t("Image export coming soon — use text share for now.")}</p>

        <div className={styles.actions}>
          <button className={styles.actionBtn} onClick={handleCopyText}>
            {copiedText ? t("Copied!") : t("Share as text")}
          </button>
        </div>
      </div>
    </div>
  );
}
