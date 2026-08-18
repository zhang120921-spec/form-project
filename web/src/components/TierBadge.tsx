import { TIERS, tierFor } from "@engine/index.ts";
import styles from "./TierBadge.module.css";
import { t } from "@/lib/i18n";

const TIER_COLORS: Record<string, string> = {
  "First Light": "#D4A574",
  "Long Shadow": "#E8C547",
  "Golden Hour": "#C2853B",
  "Afternoon": "#D4843B",
  "Overcast": "#8B4513",
  "Twilight": "#4A3728",
};

interface Props {
  rankIndex: number;
  total: number;
}

export function getTier(rankIndex: number, total: number): string | null {
  const tierResult = tierFor(rankIndex, total);
  return tierResult ? tierResult[0] : null;
}

export function getTierDescription(tier: string): string {
  switch (tier) {
    case "First Light":
      return t("Top 2% of rated players");
    case "Long Shadow":
      return t("Top 8% of rated players");
    case "Golden Hour":
      return t("Top 20% of rated players");
    case "Afternoon":
      return t("Top 45% of rated players");
    case "Overcast":
      return t("Top 75% of rated players");
    case "Twilight":
      return t("All rated players");
    default:
      return "";
  }
}

export default function TierBadge({ rankIndex, total }: Props) {
  const tier = getTier(rankIndex, total);
  if (!tier) return null;

  const color = TIER_COLORS[tier] || "var(--ink-2)";
  const description = getTierDescription(tier);

  return (
    <span
      className={styles.badge}
      style={{ "--tier-color": color } as React.CSSProperties}
      title={description}
    >
      {tier}
    </span>
  );
}
