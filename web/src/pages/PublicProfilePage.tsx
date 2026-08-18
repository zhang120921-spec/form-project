import { useParams, Link } from "react-router-dom";
import { useState } from "react";
import { usePublicProfile } from "@/hooks/useAI";
import { api, ApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import styles from "./PublicProfilePage.module.css";

export default function PublicProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error } = usePublicProfile(id ?? null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [added, setAdded] = useState(false);

  if (loading) {
    return <div className={styles.loading}>{t("Loading profile…")}</div>;
  }

  if (error) {
    return (
      <div className={styles.errorWrap}>
        <p className={styles.error}>{error}</p>
        <Link to="/leaderboard" className={styles.backLink}>
          ← {t("Back to leaderboard")}
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.errorWrap}>
        <p className={styles.error}>{t("Profile not found.")}</p>
        <Link to="/leaderboard" className={styles.backLink}>
          ← {t("Back to leaderboard")}
        </Link>
      </div>
    );
  }

  const handleAddFriend = async () => {
    setAdding(true);
    setAddError("");
    try {
      await api.post("/friends/request", { toId: id });
      setAdded(true);
    } catch (e) {
      setAddError(
        e instanceof ApiError ? e.message : t("Failed to send friend request")
      );
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link to="/leaderboard" className={styles.backLink}>
          ← {t("Leaderboard")}
        </Link>
      </div>

      <div className={styles.profileCard}>
        <div className={styles.avatar}>
          {data.displayName.charAt(0).toUpperCase()}
        </div>
        <div className={styles.info}>
          <span className={styles.name}>{data.displayName}</span>
          {(data.homeClub || data.region) && (
            <span className={styles.meta}>
              {[data.homeClub, data.region].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
      </div>

      <div className={styles.statGrid}>
        {data.rating != null && (
          <div className={styles.statTile}>
            <span className={styles.statVal}>{Math.round(data.rating)}</span>
            <span className={styles.statLabel}>{t("Rating")}</span>
          </div>
        )}
        <div className={styles.statTile}>
          <span className={styles.statVal}>{data.matches}</span>
          <span className={styles.statLabel}>{t("Rounds")}</span>
        </div>
        {data.hcpIndex != null && (
          <div className={styles.statTile}>
            <span className={styles.statVal}>{data.hcpIndex.toFixed(1)}</span>
            <span className={styles.statLabel}>{t("Handicap")}</span>
          </div>
        )}
        <div className={styles.statTile}>
          <span className={styles.statVal}>
            {data.isProvisional ? t("Provisional") : t("Verified")}
          </span>
          <span className={styles.statLabel}>{t("Status")}</span>
        </div>
      </div>

      <div className={styles.actions}>
        {!added ? (
          <button
            className={styles.addBtn}
            onClick={handleAddFriend}
            disabled={adding}
          >
            {adding ? t("Sending…") : t("Add as friend")}
          </button>
        ) : (
          <span className={styles.addedMsg}>{t("Friend request sent")}</span>
        )}
        {addError && <span className={styles.addError}>{addError}</span>}
      </div>
    </div>
  );
}
