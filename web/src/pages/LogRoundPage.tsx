import { useState } from "react";
import { Link } from "react-router-dom";
import { useFriends, useCourses } from "@/hooks/useData";
import { t } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import LogRoundForm from "@/components/LogRoundForm";
import ScorecardCapture from "@/components/ScorecardCapture";
import type { ScorecardDraft } from "@/lib/scorecard-capture";
import styles from "./LogRoundPage.module.css";

export default function LogRoundPage() {
  const { friends } = useFriends();
  const { courses } = useCourses();
  const { user } = useAuth();
  const [mode, setMode] = useState<"menu" | "capture" | "manual">("menu");
  const [successMsg, setSuccessMsg] = useState("");

  if (mode === "capture") {
    return (
      <div className={styles.page}>
        <ScorecardCapture
          friends={friends}
          courses={courses}
          onCommit={(draft: ScorecardDraft) => {
            setMode("menu");
            setSuccessMsg(
              t("Round captured: {n} players at {course}. Opponents will be asked to confirm.", { n: draft.fields.length, course: draft.courseName ?? t("unknown course") })
            );
            setTimeout(() => setSuccessMsg(""), 5000);
          }}
          onCancel={() => setMode("menu")}
        />
      </div>
    );
  }

  if (mode === "manual") {
    return (
      <div className={styles.page}>
        <LogRoundForm
          friends={friends}
          courses={courses}
          currentUserId={user?.id}
          currentUserName={user?.displayName}
          onSuccess={() => {
            setMode("menu");
            setSuccessMsg(t("Round logged. Opponents will be asked to confirm."));
            setTimeout(() => setSuccessMsg(""), 5000);
          }}
          onCancel={() => setMode("menu")}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <h2 className={styles.title}>{t("Log a Round")}</h2>
        <p className={styles.desc}>
          {t("Three ways to enter scores. Capture with your phone, speak it, or type it in — your choice. Ratings update immediately.")}
        </p>

        {successMsg && (
          <div className={styles.success}>
            <p>{successMsg}</p>
            <Link to="/sandbag" className={styles.attestLink}>
              {t("Ratings here can't be sandbagged →")}
            </Link>
          </div>
        )}

        {friends.length === 0 ? (
          <div className={styles.warning}>
            <p>{t("Add friends first — you need at least one friend to log a round.")}</p>
          </div>
        ) : courses.length === 0 ? (
          <div className={styles.warning}>
            <p>{t("No courses available. Contact an admin to add courses.")}</p>
          </div>
        ) : (
          <div className={styles.ctaGroup}>
            <button className={styles.cta} onClick={() => setMode("capture")}>
              {t("Capture Scorecard")}
            </button>
            <button className={styles.ctaSecondary} onClick={() => setMode("manual")}>
              {t("Enter Manually")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
