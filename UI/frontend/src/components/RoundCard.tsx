import type { ReplayedRound, PlayerState } from "@/lib/types";
import { useState } from "react";
import { useNarrator } from "@/hooks/useAI";
import AiBadge from "./AiBadge";
import styles from "./RoundCard.module.css";
import { t } from "@/lib/i18n";

interface Props {
  round: ReplayedRound;
  players: PlayerState[];
  showMaths?: boolean;
  onToggleMaths?: () => void;
}

function playerName(id: string, players: PlayerState[]): string {
  return players.find((p) => p.id === id)?.name ?? id.slice(0, 6);
}

export default function RoundCard({ round, players, showMaths, onToggleMaths }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { narrative, loading, error, generate, source } = useNarrator(round.id);

  return (
    <div className={`${styles.card} rule-light-bottom`}>
      <button className={styles.summary} onClick={() => setExpanded(!expanded)}>
        <div className={styles.meta}>
          <span className={styles.date}>{round.date}</span>
          <span className={styles.course}>{round.course}</span>
          <span className={styles.badge}>
            {round.format === "stroke" ? t("stroke") : round.format === "match" ? t("match") : t("stableford")}
            {round.holes !== 18 ? ` ${t("{n}h", { n: round.holes })}` : ""}
          </span>
          {round.flagged && (
            <span className={styles.flagBadge}>{t("⚠ Flagged")}</span>
          )}
        </div>
        <div className={styles.players}>
          {round.snapshot.map((s) => {
            const d = Math.round(s.delta);
            const cls = d > 0 ? styles.pos : d < 0 ? styles.neg : "";
            return (
              <span key={s.playerId} className={styles.player}>
                <span>{playerName(s.playerId, players)}</span>
                <span className={`${styles.score} ${cls}`}>
                  {d > 0 ? "▲ +" : d < 0 ? "▼ −" : "→ "}{Math.abs(d)}
                </span>
              </span>
            );
          })}
        </div>
      </button>

      {expanded && (
        <div className={styles.detail}>
          {round.flagged && round.flagReason && (
            <p className={styles.flagReason}>{round.flagReason}</p>
          )}

          {round.narration && (
            <p className={styles.narration}>{round.narration}</p>
          )}

          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("Player")}</th>
                <th>{t("Before")}</th>
                <th>{t("After")}</th>
                <th>Δ</th>
                <th>K</th>
                {round.snapshot.some((s) => s.hcp != null) && <th>{t("Handicap")}</th>}
              </tr>
            </thead>
            <tbody>
              {round.snapshot.map((s) => (
                <tr key={s.playerId}>
                  <td>{playerName(s.playerId, players)}</td>
                  <td className="mono">{Math.round(s.before)}</td>
                  <td className="mono">{Math.round(s.after)}</td>
                  <td className={`mono ${s.delta > 0 ? styles.pos : styles.neg}`}>
                    {s.delta > 0 ? "▲ +" : s.delta < 0 ? "▼ −" : "→ "}{Math.abs(Math.round(s.delta))}
                  </td>
                  <td className="mono">{Math.round(s.k)}</td>
                  {round.snapshot.some((s2) => s2.hcp != null) && (
                    <td className="mono">
                      {s.hcp != null ? s.hcp.toFixed(1) : "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {onToggleMaths && (
            <button className={styles.mathsBtn} onClick={onToggleMaths}>
              {t("Show the maths →")}
            </button>
          )}

          <div className={styles.narrator}>
            {narrative ? (
              <>
                {source === "ai" && <AiBadge />}
                <p className={styles.narratorText}>{narrative}</p>
              </>
            ) : (
              <button
                className={styles.narratorBtn}
                onClick={generate}
                disabled={loading}
              >
                {loading ? t("Narrating…") : t("Narrate this round")}
              </button>
            )}
            {error && <span className={styles.narratorErr}>{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
