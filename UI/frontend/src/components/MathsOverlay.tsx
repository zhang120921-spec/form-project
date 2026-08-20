import type { ReplayedRound, PlayerState } from "@engine/index.ts";
import { t } from "@/lib/i18n";
import { useNarrator } from "@/hooks/useAI";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import AiBadge from "./AiBadge";
import styles from "./MathsOverlay.module.css";

interface Props {
  round: ReplayedRound;
  players: PlayerState[];
  onClose: () => void;
}

function pName(id: string, players: PlayerState[]): string {
  return players.find((p) => p.id === id)?.name ?? id.slice(0, 6);
}

export default function MathsOverlay({ round, players, onClose }: Props) {
  const { narrative, loading, error, generate, source } = useNarrator(round.id);

  useEscapeKey(onClose);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="maths-overlay-title"
      >
        <div className={styles.head}>
          <div>
            <span id="maths-overlay-title" className={styles.title}>{t("The Maths")}</span>
            <span className={styles.subtitle}>
              {round.date} · {round.course} · {round.format}
              {round.holes !== 18 ? t(" · {n} holes", { n: round.holes }) : ""}
            </span>
          </div>
          <button className={styles.close} onClick={onClose} aria-label={t("Close")}>
            ×
          </button>
        </div>

        <div className={styles.body}>
          <section className={styles.block}>
            <h3>{t("Parameters")}</h3>
            <div className={styles.grid}>
              <div>
                <span className={styles.label}>{t("α (alpha)")}</span>
                <span className={styles.val}>{round.alpha.toFixed(4)}</span>
              </div>
              <div>
                <span className={styles.label}>{t("Holes")}</span>
                <span className={styles.val}>{round.holes}</span>
              </div>
              <div>
                <span className={styles.label}>{t("Format")}</span>
                <span className={styles.val}>{round.format}</span>
              </div>
            </div>
          </section>

          <section className={styles.block}>
            <h3>{t("Pairwise Comparisons")}</h3>
            <p className={styles.formula}>
              S(m) = 1 / (1 + e<sup>−α·m</sup>) · E = 1 / (1 + 10<sup>(R<sub>B</sub>−R<sub>A</sub>)/400</sup>)
            </p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("A")}</th>
                  <th>{t("B")}</th>
                  <th>{t("m (margin)")}</th>
                  <th>{t("S (score)")}</th>
                  <th>{t("E (expected)")}</th>
                  <th>{t("S − E")}</th>
                </tr>
              </thead>
              <tbody>
                {round.pairs.map((pair, i) => (
                  <tr key={i}>
                    <td>{pName(pair.a, players)}</td>
                    <td>{pName(pair.b, players)}</td>
                    <td>{pair.margin.toFixed(2)}</td>
                    <td>{pair.score.toFixed(4)}</td>
                    <td>{pair.expected.toFixed(4)}</td>
                    <td className={pair.delta >= 0 ? styles.pos : styles.neg}>
                      {pair.delta > 0 ? "▲ +" : pair.delta < 0 ? "▼ −" : "→ "}{Math.abs(pair.delta).toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className={styles.block}>
            <h3>{t("Rating Updates")}</h3>
            <p className={styles.formula}>
              ΔR = K × Σ(S−E) / (n−1)
            </p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("Player")}</th>
                  <th>{t("Rating Before")}</th>
                  <th>{t("Σ(S−E)")}</th>
                  <th>{t("K")}</th>
                  <th>{t("ΔR")}</th>
                  <th>{t("Rating After")}</th>
                </tr>
              </thead>
              <tbody>
                {round.snapshot.map((s) => (
                  <tr key={s.playerId}>
                    <td>{pName(s.playerId, players)}</td>
                    <td className="mono">{Math.round(s.before)}</td>
                    <td className="mono">
                      {(round.pairs
                        .filter((p) => p.a === s.playerId || p.b === s.playerId)
                        .reduce((sum, p) => {
                          const val = p.a === s.playerId ? p.delta : -p.delta;
                          return sum + val;
                        }, 0)
                      ).toFixed(4)}
                    </td>
                    <td className="mono">{Math.round(s.k)}</td>
                    <td className={`mono ${s.delta >= 0 ? styles.pos : styles.neg}`}>
                      {s.delta > 0 ? "▲ +" : s.delta < 0 ? "▼ −" : "→ "}{Math.abs(s.delta).toFixed(1)}
                    </td>
                    <td className="mono">{Math.round(s.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {round.snapshot.some((s) => s.hcp != null) && (
            <section className={styles.block}>
              <h3>{t("Handicap (WHS)")}</h3>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t("Player")}</th>
                    <th>{t("HCP Before")}</th>
                    <th>{t("HCP After")}</th>
                    <th>{t("Δ")}</th>
                  </tr>
                </thead>
                <tbody>
                  {round.snapshot
                    .filter((s) => s.hcp != null)
                    .map((s) => (
                      <tr key={s.playerId}>
                        <td>{pName(s.playerId, players)}</td>
                        <td className="mono">{s.hcpBefore?.toFixed(1)}</td>
                        <td className="mono">{s.hcp?.toFixed(1)}</td>
                        <td className={`mono ${(s.hcpDelta ?? 0) < 0 ? styles.pos : styles.neg}`}>
                          {(s.hcpDelta ?? 0) > 0 ? "▲ +" : (s.hcpDelta ?? 0) < 0 ? "▼ −" : "→ "}{Math.abs(s.hcpDelta ?? 0).toFixed(1)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          )}

          <section className={styles.narratorSection}>
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
          </section>
        </div>
      </div>
    </div>
  );
}
