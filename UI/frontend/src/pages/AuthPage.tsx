import { useState, useMemo, type FormEvent } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import { parseHandicap } from "@/lib/handicap";
import { seedRating, DEFAULTS } from "@engine/index.ts";
import { t, useLang, toggleLang } from "@/lib/i18n";
import styles from "./AuthPage.module.css";

export default function AuthPage() {
  const { user, loading, error, login, register, clearError, requestPasswordReset, resetPassword } = useAuth();
  const lang = useLang();
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [homeClub, setHomeClub] = useState("");
  const [sgaHandicap, setSgaHandicap] = useState("");
  const [showHandicap, setShowHandicap] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");
  const [consent, setConsent] = useState(false);

  // Forgot-password flow: request a code, then redeem it for a new password.
  // No email system in this trial — the coach looks the code up in the admin
  // panel and hands it to the student out-of-band.
  const [resetRequested, setResetRequested] = useState(false);
  const [showRedeem, setShowRedeem] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetDone, setResetDone] = useState(false);

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

  const switchMode = (next: "login" | "register" | "reset") => {
    setMode(next);
    clearError();
    setLocalError("");
    setResetRequested(false);
    setShowRedeem(false);
    setResetToken("");
    setNewPassword("");
    setResetDone(false);
  };

  const handleRequestReset = async () => {
    if (!email.trim()) {
      setLocalError(t("Enter your email first"));
      return;
    }
    setLocalError("");
    clearError();
    setSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      setResetRequested(true);
      setShowRedeem(true);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : t("Something went wrong"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError("");
    clearError();
    setSubmitting(true);

    try {
      if (mode === "reset") {
        if (!resetToken.trim() || newPassword.length < 6) {
          setLocalError(t("Enter your reset code and a new password (min 6 characters)"));
          setSubmitting(false);
          return;
        }
        await resetPassword(resetToken.trim(), newPassword);
        setResetDone(true);
        setPassword("");
        setResetToken("");
        setNewPassword("");
      } else if (mode === "login") {
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
              onClick={() => switchMode("login")}
            >
              {t("Sign In")}
            </button>
            <button
              type="button"
              className={`${styles.tab} ${mode === "register" ? styles.tabActive : ""}`}
              onClick={() => switchMode("register")}
            >
              {t("Register")}
            </button>
          </div>

          {displayError && <div className={styles.error}>{displayError}</div>}

          {mode === "reset" && resetDone ? (
            <>
              <div className={styles.resetDone}>
                {t("Password reset. Sign in with your new password.")}
              </div>
              <button type="button" className={styles.submit} onClick={() => switchMode("login")}>
                {t("Back to Sign In")}
              </button>
            </>
          ) : (
            <>
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
              disabled={mode === "reset" && showRedeem}
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

              {showHandicap ? (
                <fieldset className={styles.field}>
                  <div className={styles.fieldHeader}>
                    <label className={styles.label}>{t("Handicap Index (optional)")}</label>
                    <button
                      type="button"
                      className={styles.toggleLink}
                      onClick={() => { setShowHandicap(false); setSgaHandicap(""); }}
                    >
                      {t("Hide")}
                    </button>
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={styles.input}
                    value={sgaHandicap}
                    onChange={(e) => setSgaHandicap(e.target.value)}
                    placeholder={t("e.g. 12.4 or +2")}
                    autoFocus
                  />
                  <small className={styles.hint}>
                    {t("Optional — lets you start closer to your real level. Use + for plus-handicaps (e.g. +2).")}
                  </small>
                  {ratingPreview != null && (
                    <div className={styles.ratingPreview}>
                      {t("You'll start around {rating}", { rating: ratingPreview })}
                    </div>
                  )}
                </fieldset>
              ) : (
                <button
                  type="button"
                  className={styles.toggleLink}
                  onClick={() => setShowHandicap(true)}
                >
                  {t("Already have a handicap index? Add it →")}
                </button>
              )}

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

          {mode !== "reset" && (
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
          )}

          {mode === "login" && (
            <button type="button" className={styles.toggleLink} onClick={() => switchMode("reset")}>
              {t("Forgot password?")}
            </button>
          )}

          {mode === "reset" && (
            <>
              {resetRequested && (
                <div className={styles.resetNotice}>
                  {t("If that email is registered, a reset code has been generated — ask your coach for it.")}
                </div>
              )}

              {showRedeem ? (
                <>
                  <fieldset className={styles.field}>
                    <label className={styles.label}>{t("Reset Code")}</label>
                    <input
                      type="text"
                      className={styles.input}
                      value={resetToken}
                      onChange={(e) => setResetToken(e.target.value)}
                      placeholder={t("Code from your coach")}
                      autoFocus
                    />
                  </fieldset>
                  <fieldset className={styles.field}>
                    <label className={styles.label}>{t("New Password")}</label>
                    <input
                      type="password"
                      className={styles.input}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder={t("Min 6 characters")}
                      minLength={6}
                      autoComplete="new-password"
                    />
                  </fieldset>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.toggleLink}
                  onClick={() => setShowRedeem(true)}
                >
                  {t("Already have a reset code? Enter it →")}
                </button>
              )}
            </>
          )}

          <button
            type={mode === "reset" && !showRedeem ? "button" : "submit"}
            className={styles.submit}
            disabled={submitting}
            onClick={mode === "reset" && !showRedeem ? handleRequestReset : undefined}
          >
            {submitting
              ? mode === "login"
                ? t("Signing in...")
                : mode === "register"
                ? t("Creating account...")
                : showRedeem
                ? t("Resetting...")
                : t("Sending...")
              : mode === "login"
              ? t("Sign In")
              : mode === "register"
              ? t("Create Account")
              : showRedeem
              ? t("Reset Password")
              : t("Send Reset Code")}
          </button>
            </>
          )}
        </form>

        <p className={styles.footer}>
          {t("Ratings are computed fresh — never stored. Ratings here can't be sandbagged.")}
        </p>
      </div>
    </div>
  );
}
