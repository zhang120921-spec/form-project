import { t } from "@/lib/i18n";
import styles from "./AiBadge.module.css";

/** Small label distinguishing live AI-generated text from the deterministic
 *  template fallback — both exist in this app by design, so which one a
 *  user is looking at is worth showing, not hiding. */
export default function AiBadge() {
  return <span className={styles.badge}>{t("✦ AI")}</span>;
}
