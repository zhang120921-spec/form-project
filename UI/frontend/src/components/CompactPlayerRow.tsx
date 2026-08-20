import { Link } from "react-router-dom";
import type { PlayerState } from "@engine/index.ts";
import FormStrip from "./FormStrip";
import styles from "./CompactPlayerRow.module.css";
import { t } from "@/lib/i18n";

type FormResult = "W" | "L" | "T";

interface Props {
  player: PlayerState;
  rank: number;
  totalPlayers: number;
  isYou?: boolean;
  formResults?: FormResult[];
}

export default function CompactPlayerRow({ player, rank, totalPlayers, isYou = false, formResults }: Props) {
  const delta = player.curve.length > 1
    ? player.rating - player.curve[0].r
    : 0;
  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "→";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const deltaClass = delta > 0 ? styles.pos : delta < 0 ? styles.neg : "";

  const target = isYou ? "/profile" : `/player/${player.id}`;

  return (
    <Link to={target} className={`${styles.row} rule-bottom ${isYou ? styles.youRow : ""}`}>
      <span className={styles.rank}>#{rank}</span>
      <div className={styles.info}>
        <span className={styles.name}>
          {isYou && <span className={styles.youMark}>{t("YOU ")}</span>}
          {player.name}
        </span>
        <span className={styles.club}>{player.club}</span>
      </div>
      <div className={styles.rating}>
        <span className={styles.ratingNum}>{Math.round(player.rating)}</span>
        <span className={`${styles.delta} ${deltaClass}`}>
          {arrow} {sign}{Math.abs(Math.round(delta))}
        </span>
      </div>
      {formResults && formResults.length > 0 && (
        <div className={styles.formArea}>
          <FormStrip results={formResults} compact />
        </div>
      )}
      <span className={styles.rounds}>{t("{n} rounds", { n: player.matches })}</span>
    </Link>
  );
}
