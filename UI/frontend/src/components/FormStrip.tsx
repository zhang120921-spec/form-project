import styles from "./FormStrip.module.css";
import { t } from "@/lib/i18n";

type Result = "W" | "L" | "T";

interface Props {
  results: Result[];
  maxDots?: number;
  compact?: boolean;
  showLabel?: boolean;
}

function formChar(result: Result | null): string {
  if (result === "W") return "W";
  if (result === "L") return "L";
  if (result === "T") return "T";
  return "—";
}

function formTooltip(result: Result | null): string {
  if (result === "W") return t("Win");
  if (result === "L") return t("Loss");
  if (result === "T") return t("Tie");
  return t("No result");
}

export default function FormStrip({
  results,
  maxDots = 5,
  compact = false,
  showLabel = false,
}: Props) {
  const dots: (Result | null)[] = [];

  const recent = results.slice(-maxDots);
  for (let i = 0; i < maxDots; i++) {
    dots.push(recent[i] ?? null);
  }

  return (
    <span className={styles.wrapper} role="list" aria-label={t("Recent form: wins and losses")}>
      {showLabel && <span className={styles.label}>{t("Form:")}</span>}
      <span className={`${styles.strip} ${compact ? styles.compact : ""}`} role="presentation">
        {dots.map((dot, i) => (
          <span
            key={i}
            role="listitem"
            className={`${styles.dot} ${
              dot === "W"
                ? styles.win
                : dot === "L"
                ? styles.loss
                : dot === "T"
                ? styles.tie
                : styles.empty
            }`}
            title={formTooltip(dot)}
            aria-label={formTooltip(dot)}
          >
            <span className="sr-only">{formChar(dot)}</span>
          </span>
        ))}
      </span>
    </span>
  );
}
