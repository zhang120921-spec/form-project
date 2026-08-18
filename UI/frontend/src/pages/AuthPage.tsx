import { useState, useMemo, type FormEvent } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import { parseHandicap } from "@/lib/handicap";
import { seedRating, DEFAULTS } from "@engine/index.ts";
import { t, useLang, toggleLang } from "@/lib/i18n";
import styles from "./AuthPage.module.css";

export default function AuthPage() {
  const { user, loading, error, login, register, clearError } = useAuth();
  const lang = useLang();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [homeClub, setHomeClub] = useState("");
  const [sgaHandicap, setSgaHandicap] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");
  const [consent, setConsent] = useState(false);

  const ratingPreview = useMemo(() => {
    const trimmed = sgaHandicap.trim();
    if (!trimmed) return null;

    const parsed = parseHandicap(trimmed);
    if (!parsed.ok || parsed.value == null) return null;

    return Math.round(seedRating(parsed.value, DEFAULTS));
  }, [sgaHandicap]);

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>{t("Loading...")}</div>
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError("");
    clearError();
    setSubmitting(true);

    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        if (displayName.trim().length < 1) {
          setLocalError(t("Name is required"));
          setSubmitting(false);
          return;
        }

        if (!consent) {
          setLocalError(t("Please agree to the privacy policy to create an account"));
          setSubmitting(false);
          return;
        }

        let hcp: number | undefined;
        if (sgaHandicap.trim()) {
          const parsed = parseHandicap(sgaHandicap);
          if (!parsed.ok) {
            setLocalError(parsed.error || t("Invalid handicap index"));
            setSubmitting(false);
            return;
          }
          hcp = parsed.value ?? undefined;
        }

        await register(
          email,
          password,
          displayName.trim(),
          homeClub.trim() || undefined,
          hcp,
          consent
        );
      }
    } catch {
      // error is set by auth context
    } finally {
      setSubmitting(false);
    }
  };

  const displayError = localError || error;

  return (
    <div className={styles.page}>
      <button type="button" className={styles.langBtn} onClick={toggleLang}>
        {lang === "en" ? "中文" : "EN"}
      </button>
      <div className={styles.card}>
        <div className={styles.header}>
          <h1 className={styles.logo}>FORM</h1>
          <p className={styles.tagline}>{t("Know where you stand")}</p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${mode === "login" ? styles.tabActive : ""}`}
              onClick={() => { setMode("login"); clearError(); setLocalError(""); }}
            >
              {t("Sign In")}
            </button>
            <button
              type="button"
              className={`${styles.tab} ${mode === "register" ? styles.tabActive : ""}`}
              onClick={() => { setMode("register"); clearError(); setLocalError(""); }}
            >
              {t("Register")}
            </button>
          </div>

          {displayError && <div className={styles.error}>{displayError}</div>}

          <fieldset className={styles.field}>
            <label className={styles.label}>{t("Email")}</label>
            <input
              type="email"
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("you@example.com")}
              required
              autoComplete="email"
            />
          </fieldset>

          {mode === "register" && (
            <>
              <fieldset className={styles.field}>
                <label className={styles.label}>{t("Display Name")}</label>
                <input
                  type="text"
                  className={styles.input}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t("Your name")}
                  required
                />
              </fieldset>

              <fieldset className={styles.field}>
                <label className={styles.label}>{t("Home Club")}</label>
                <input
                  type="text"
                  className={styles.input}
                  value={homeClub}
                  onChange={(e) => setHomeClub(e.target.value)}
                  placeholder={t("e.g. Sentosa Golf Club")}
                />
              </fieldset>

              <fieldset className={styles.field}>
                <label className={styles.label}>{t("Handicap Index")}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className={styles.input}
                  value={sgaHandicap}
                  onChange={(e) => setSgaHandicap(e.target.value)}
                  placeholder={t("e.g. 12.4 or +2")}
                />
                <small className={styles.hint}>
                  {t("Seeds your starting rating. A scratch golfer starts ~2438, an 18-handicap at 1500. Use + for plus-handicaps (e.g. +2).")}
                </small>
                <div className={styles.ratingPreview}>
                  {ratingPreview != null
                    ? t("You'll start around {rating}", { rating: ratingPreview })
                    : t("Enter your index and we'll show your starting rating.")}
                </div>
              </fieldset>

              <label className={styles.consent}>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  {t("I agree to the Privacy Policy — my data (name, scores, handicap) is stored only on this trial server and used solely for the FORM rating system. I can request deletion at any time.")}
                </span>
              </label>
            </>
          )}

          <fieldset className={styles.field}>
            <label className={styles.label}>{t("Password")}</label>
            <input
              type="password"
              className={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? t("Min 6 characters") : t("Your password")}
              required
              minLength={6}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </fieldset>

          <button type="submit" className={styles.submit} disabled={submitting}>
            {submitting
              ? mode === "login"
                ? t("Signing in...")
                : t("Creating account...")
              : mode === "login"
              ? t("Sign In")
              : t("Create Account")}
          </button>
        </form>

        <p className={styles.footer}>
          {t("Ratings are computed fresh — never stored. Ratings here can't be sandbagged.")}
        </p>
      </div>
    </div>
  );
}
