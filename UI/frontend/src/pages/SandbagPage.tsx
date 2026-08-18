import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { runSandbagSim } from "@/lib/sandbag-sim";
import { t } from "@/lib/i18n";
import styles from "./SandbagPage.module.css";

const START_RATING = 1500;

function ResultCard({
  label,
  rating,
  hcp,
  started,
  variant,
}: {
  label: string;
  rating: number;
  hcp: number | null;
  started: number;
  variant: "sandbag" | "honest";
}) {
  const delta = rating - started;
  const deltaCls = delta > 0 ? styles.pos : delta < 0 ? styles.neg : "";
  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "→";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";

  return (
    <div className={`${styles.resultCard} ${variant === "sandbag" ? styles.sandbagCard : styles.honestCard}`}>
      <span className={styles.resultLabel}>{label}</span>
      <div className={styles.resultRating}>{Math.round(rating)}</div>
      <span className={`${styles.resultDelta} ${deltaCls}`}>
        {arrow} {sign}{t("{n} rating", { n: Math.abs(Math.round(delta)) })}
      </span>
      <div className={styles.resultHcp}>
        <span className={styles.hcpLabel}>{t("Handicap")}</span>
        <span className={styles.hcpVal}>{hcp != null ? hcp.toFixed(1) : "—"}</span>
      </div>
    </div>
  );
}

export default function SandbagPage() {
  const [runSandbag, setRunSandbag] = useState(false);
  const [runHonest, setRunHonest] = useState(false);

  // Compute results lazily — only when a button has been pressed.
  // useMemo ensures the engine call is deterministic and not re-run
  // on every render, while still being a genuine replay() call.
  const sim = useMemo(() => {
    if (!runSandbag && !runHonest) return null;
    return runSandbagSim();
  }, [runSandbag, runHonest]);

  const bothRun = runSandbag && runHonest && sim != null;

  return (
    <div className={styles.page}>
      {/* ── Problem ── */}
      <section className={styles.section}>
        <h2 className={styles.heading}>{t("Why FORM can't be sandbagged")}</h2>
        <p className={styles.lede}>
          {t("Everyone knows someone whose handicap is a bit convenient.")}
        </p>
        <p className={styles.body}>
          {t("A handicap gives you shots. So playing badly can win you prizes. Your FORM rating doesn't give you anything — it just says how you're playing. Playing badly makes it go down. There's nothing to gain by hiding a good round.")}
        </p>
      </section>

      {/* ── Interactive simulator ── */}
      <section className={styles.section}>
        <h3 className={styles.subHeading}>{t("See for yourself")}</h3>
        <p className={styles.body}>
          {t("Two identical golfers start at 1500. Same opponents, same course, ten rounds. One deliberately inflates their scores. The other plays honestly. Watch what happens.")}
        </p>

        <div className={styles.simButtons}>
          <button
            className={`${styles.simBtn} ${runSandbag ? styles.simBtnActive : ""}`}
            onClick={() => setRunSandbag(true)}
          >
            {t("See what happens if you sandbag")}
          </button>
          <button
            className={`${styles.simBtn} ${runHonest ? styles.simBtnActive : ""}`}
            onClick={() => setRunHonest(true)}
          >
            {t("See what happens if you play honestly")}
          </button>
        </div>

        {sim && (
          <div className={styles.results}>
            {runSandbag && (
              <ResultCard
                label={t("Sandbagger")}
                rating={sim.sandbag.rating}
                hcp={sim.sandbag.hcpIndex}
                started={START_RATING}
                variant="sandbag"
              />
            )}
            {runHonest && (
              <ResultCard
                label={t("Honest player")}
                rating={sim.honest.rating}
                hcp={sim.honest.hcpIndex}
                started={START_RATING}
                variant="honest"
              />
            )}
          </div>
        )}

        {bothRun && (
          <p className={styles.closingLine}>
            {t("Under handicap rules, the player on the left now gets more shots. Under FORM, they're just worse.")}
          </p>
        )}
      </section>

      {/* ── Honest limits ── */}
      <section className={styles.section}>
        <h3 className={styles.subHeading}>{t("What this doesn't solve")}</h3>
        <p className={styles.body}>
          {t("Sandbag immunity means the")} <em>{t("rating")}</em>{" "}
          {t("can't be manipulated by playing badly. It doesn't protect against every form of dishonesty. Someone can still report a score they didn't shoot, or only play weak opponents to farm easy wins.")}
        </p>
        <p className={styles.body}>
          {t("Two separate mechanisms address those.")}{" "}
          <Link to="/profile" className={styles.inlineLink}>
            {t("Round attestation")}
          </Link>{" "}
          {t("requires an opponent to confirm the scorecard before it counts. The opponent-diversity measure flags players who only ever play the same weak field. Both work alongside the rating — neither is the rating.")}
        </p>
      </section>
    </div>
  );
}
