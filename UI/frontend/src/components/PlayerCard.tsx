import { Link } from "react-router-dom";
import type { PlayerState } from "@engine/index.ts";
import FormStrip from "./FormStrip";
import styles from "./PlayerCard.module.css";
import { t } from "@/lib/i18n";

type FormResult = "W" | "L" | "T";

interface Props {
  player: PlayerState;
  rank: number;
  totalPlayers?: number;
  showDetail?: boolean;
  isYou?: boolean;
  formResults?: FormResult[];
}

export default function PlayerCard({ player, rank, totalPlayers, showDetail = true, isYou = false, formResults }: Props) {
  const delta = player.curve.length > 1
    ? player.rating - player.curve[0].r
    : 0;
  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "→";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const deltaClass = delta > 0 ? styles.pos : delta < 0 ? styles.neg : "";
  const provisional = player.isProvisional;

  const target = isYou ? "/profile" : `/player/${player.id}`;

  return (
    <Link to={target} className={`${styles.card} rule-light-bottom ${isYou ? styles.youRow : ""}`}>
      <div className={styles.main}>
        <span className={styles.rank}>#{rank}</span>
        <div className={styles.info}>
          <span className={styles.name}>{player.name}</span>
          <span className={styles.club}>{player.club}</span>
        </div>
        <div className={styles.ratingArea}>
          <div className={styles.rating}>
            <span className={styles.ratingNum}>{Math.round(player.rating)}</span>
            <span className={`${styles.delta} ${deltaClass}`}>
              {arrow} {sign}{Math.abs(Math.round(delta))}
            </span>
          </div>
        </div>
        {formResults && formResults.length > 0 && (
          <div className={styles.formArea}>
            <FormStrip results={formResults} compact />
          </div>
        )}
      </div>
      {showDetail && (
        <div className={styles.detail}>
          {provisional && (
            <span className={styles.provisional}>{t("New — still settling")}</span>
          )}
          <span>
            {player.matches === 1 ? t("1 round") : t("{n} rounds", { n: player.matches })}
          </span>
          {player.hcpIndex != null && (
            <span>{t("handicap {hcp}", { hcp: player.hcpIndex.toFixed(1) })}</span>
          )}
          {player.daysIdle < 999 && (
            <span>{t("played {n} days ago", { n: player.daysIdle })}</span>
          )}
        </div>
      )}
    </Link>
  );
}
