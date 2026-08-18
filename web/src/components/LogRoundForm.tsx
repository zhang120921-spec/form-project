import { useState, type FormEvent, useMemo } from "react";
import { api, ApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import { validateRound } from "../../../engine/validation";
import type { Course, FriendInfo } from "@/lib/types";
import styles from "./LogRoundForm.module.css";

interface Props {
  friends: FriendInfo[];
  courses: Course[];
  currentUserId?: string;
  currentUserName?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

type Format = "stroke" | "match" | "stableford";

// Match play result notation parsers
const MATCH_CHIPS = ["5&4", "4&3", "3&2", "2&1", "1 up", "Halved"] as const;

function parseMatchResult(input: string): { margin: number; holesPlayed: number } | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  // Halved / A/S
  if (s === "halved" || s === "a/s" || s === "as" || s === "all square") {
    return { margin: 0, holesPlayed: 18 };
  }

  // N up
  const upMatch = s.match(/^(\d+)\s*up$/);
  if (upMatch) {
    return { margin: parseInt(upMatch[1]), holesPlayed: 18 };
  }

  // N&M or N&M notation
  const nmMatch = s.match(/^(\d+)\s*[&/]\s*(\d+)$/);
  if (nmMatch) {
    const n = parseInt(nmMatch[1]);
    const m = parseInt(nmMatch[2]);
    if (m >= n) return null; // margin can't exceed holes remaining
    return { margin: n, holesPlayed: 18 - m };
  }

  return null;
}

export default function LogRoundForm({ friends, courses, currentUserId, currentUserName, onSuccess, onCancel }: Props) {
  const [mode, setMode] = useState<"manual" | "quick">("manual");
  const [quickText, setQuickText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [parseConfidence, setParseConfidence] = useState<string | null>(null);
  const [format, setFormat] = useState<Format>("stroke");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [courseId, setCourseId] = useState("");
  const [holes, setHoles] = useState(18);
  const [nine, setNine] = useState<"front" | "back" | "18">("18");
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const course = courses.find((c) => c.id === courseId);
  const tee = course?.tees[0];

  const togglePlayer = (id: string) => {
    setSelectedPlayers((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const getFriendName = (pid: string) => {
    if (pid === "self") return "";
    const f = friends.find((f) => (f.userId || f.id) === pid);
    return f?.display_name || f?.displayName || pid.slice(0, 6);
  };

  // Parse match results from all players
  const matchParseResults = useMemo(() => {
    if (format !== "match") return null;
    const allPids = ["self", ...selectedPlayers];
    const results: Record<string, { margin: number; holesPlayed: number } | null> = {};
    for (const pid of allPids) {
      const s = scores[pid];
      results[pid] = s ? parseMatchResult(s.toString()) : null;
    }
    return results;
  }, [format, scores, selectedPlayers]);

  // ── Quick Entry parse ──
  const handleQuickParse = async () => {
    if (!quickText.trim()) return;
    setParsing(true);
    setParseError("");
    setParseConfidence(null);

    try {
      const result = await api.post<{
        players: Array<{ name: string; score: number | null }>;
        course: string | null;
        format: string | null;
        date: string | null;
        confidence: string;
      }>("/ai/parse-round", { text: quickText });

      setParseConfidence(result.confidence || "low");

      // Pre-fill format
      if (result.format === "stroke" || result.format === "stableford") {
        setFormat(result.format);
      }

      // Pre-fill date
      if (result.date) {
        setDate(result.date);
      }

      // Pre-fill course
      if (result.course) {
        const match = courses.find(
          (c) =>
            c.name.toLowerCase().includes(result.course!.toLowerCase()) ||
            result.course!.toLowerCase().includes(c.name.toLowerCase())
        );
        if (match) setCourseId(match.id);
      }

      // Match player names to friends (and current user as "self")
      const matched: string[] = [];
      const newScores: Record<string, string> = {};
      const myName = (currentUserName || "").toLowerCase().trim();

      for (const p of result.players || []) {
        if (!p.name) continue;
        const cleaned = p.name.toLowerCase().trim();

        // Check if this is the current user
        if (myName && (cleaned === myName || myName.includes(cleaned) || cleaned.includes(myName))) {
          if (p.score != null) newScores["self"] = String(p.score);
          continue;
        }

        // Match against friends — try full name, first name, and last name
        let friendId: string | null = null;
        for (const f of friends) {
          const fname = (f.display_name || f.displayName || "").toLowerCase().trim();
          if (!fname) continue;

          // Full name match or substring match
          if (fname === cleaned || fname.includes(cleaned) || cleaned.includes(fname)) {
            friendId = f.userId || f.id || null;
            break;
          }

          // First-name match (e.g., "David" matches "David Lim")
          const parts = fname.split(/\s+/);
          if (parts.length > 1 && parts[0] === cleaned) {
            friendId = f.userId || f.id || null;
            break;
          }

          // Last-name match (e.g., "Lim" matches "David Lim")
          if (parts.length > 1 && parts[parts.length - 1] === cleaned) {
            friendId = f.userId || f.id || null;
            break;
          }
        }

        if (friendId && p.score != null) {
          matched.push(friendId);
          newScores[friendId] = String(p.score);
        }
      }

      if (matched.length > 0) {
        setSelectedPlayers(matched);
        setScores(newScores);
      }

      // Switch to manual mode for review
      setMode("manual");
    } catch (e) {
      setParseError(
        e instanceof ApiError
          ? e.message
          : t("Could not parse. Try manual entry.")
      );
    } finally {
      setParsing(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (selectedPlayers.length < 1) {
      setError(t("Select at least 1 other player"));
      return;
    }
    if (!courseId || !tee) {
      setError(t("Select a course"));
      return;
    }
    if (!currentUserId) {
      setError(t("You must be signed in to log a round"));
      return;
    }

    // Validate all scores entered
    const allPlayerIds = ["self", ...selectedPlayers];

    if (format === "match") {
      // Validate match results
      if (!matchParseResults) return;
      for (const pid of allPlayerIds) {
        const s = scores[pid];
        if (!s || !s.toString().trim()) {
          setError(t("Enter match results for all players"));
          return;
        }
        const parsed = matchParseResults[pid];
        if (!parsed) {
          setError(t("Invalid match result: \"{s}\". Use \"3&2\", \"1 up\", or \"Halved\".", { s }));
          return;
        }
      }
    } else {
      for (const pid of allPlayerIds) {
        const s = scores[pid];
        if (!s || isNaN(Number(s))) {
          setError(t("Enter scores for all players"));
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      const par = tee.par;
      const cr = tee.cr;
      const slope = tee.slope;

      let holesToSubmit = holes;

      const participants = allPlayerIds.map((pid) => {
        if (format === "match") {
          const parsed = matchParseResults![pid]!;
          // Use the max holesPlayed from all players
          if (parsed.holesPlayed < holesToSubmit) holesToSubmit = parsed.holesPlayed;
          return {
            playerId: pid === "self" ? currentUserId : pid,
            holesWon: parsed.margin,
            cr,
            slope,
            pcc: 0,
          };
        } else if (format === "stableford") {
          return {
            playerId: pid === "self" ? currentUserId : pid,
            points: Number(scores[pid]),
            cr,
            slope,
            pcc: 0,
          };
        } else {
          return {
            playerId: pid === "self" ? currentUserId : pid,
            ags: Number(scores[pid]),
            cr,
            slope,
            pcc: 0,
          };
        }
      });

      const payload = {
        date,
        format,
        course: course!.name,
        par,
        holes: holesToSubmit,
        nine,
        participants,
      };

      // Shared validation boundary — same as server-side
      const validation = validateRound(payload);
      if (!validation.ok) {
        setError(validation.errors.map((e) => e.message).join("; "));
        setSubmitting(false);
        return;
      }

      await api.post("/rounds", payload);

      onSuccess();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Failed to log round"));
    } finally {
      setSubmitting(false);
    }
  };

  const scoreLabel = format === "match"
    ? t("Match result")
    : format === "stableford"
    ? t("Stableford Points")
    : t("Adjusted Gross Score");

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h2 className={styles.heading}>{t("Log a Round")}</h2>

      {/* Mode toggle */}
      <div className={styles.modeToggle}>
        <button
          type="button"
          className={`${styles.modeBtn} ${mode === "manual" ? styles.modeActive : ""}`}
          onClick={() => setMode("manual")}
        >
          {t("Manual")}
        </button>
        <button
          type="button"
          className={`${styles.modeBtn} ${mode === "quick" ? styles.modeActive : ""}`}
          onClick={() => setMode("quick")}
        >
          {t("Quick Entry")}
        </button>
      </div>

      {/* Quick Entry mode */}
      {mode === "quick" && (
        <div className={styles.quickEntry}>
          <p className={styles.quickHelper}>
            {t("Describe the round in plain English. We'll parse it for you to confirm.")}
          </p>
          <textarea
            className={styles.quickText}
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            placeholder={t("Michael shot 78, Darren 81, Wei 88 at Sentosa yesterday, stroke play")}
            rows={3}
            autoFocus
          />
          {parseError && <div className={styles.error}>{parseError}</div>}
          {parseConfidence && (
            <p className={styles.parseConfidence}>
              {t("Parsed with {confidence} confidence — please review all fields.", { confidence: parseConfidence })}
            </p>
          )}
          <button
            type="button"
            className={styles.quickParseBtn}
            onClick={handleQuickParse}
            disabled={parsing || !quickText.trim()}
          >
            {parsing ? t("Parsing…") : t("Parse & review")}
          </button>
        </div>
      )}

      {/* Manual mode */}
      {mode === "manual" && (
        <>
      {error && <div className={styles.error}>{error}</div>}

      {/* Format */}
      <fieldset className={styles.field}>
        <legend className={styles.legend}>{t("Format")}</legend>
        <div className={styles.formatGrid}>
          {(["stroke", "stableford", "match"] as Format[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`${styles.formatBtn} ${format === f ? styles.formatActive : ""}`}
              onClick={() => setFormat(f)}
            >
              {f === "stroke" ? t("Stroke Play") : f === "stableford" ? t("Stableford") : t("Match Play")}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Date, Holes & Nine */}
      <div className={styles.row}>
        <fieldset className={styles.field}>
          <legend className={styles.legend}>{t("Date")}</legend>
          <input
            type="date"
            className={styles.input}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </fieldset>
        <fieldset className={styles.field}>
          <legend className={styles.legend}>{t("Holes")}</legend>
          <select
            className={styles.input}
            value={holes}
            onChange={(e) => {
              const h = Number(e.target.value);
              setHoles(h);
              if (h === 18) setNine("18");
            }}
          >
            <option value={18}>{t("18 holes")}</option>
            <option value={9}>{t("9 holes")}</option>
          </select>
        </fieldset>
        {holes === 9 && (
          <fieldset className={styles.field}>
            <legend className={styles.legend}>{t("Nine")}</legend>
            <select
              className={styles.input}
              value={nine}
              onChange={(e) => setNine(e.target.value as "front" | "back")}
            >
              <option value="front">{t("Front nine")}</option>
              <option value="back">{t("Back nine")}</option>
            </select>
          </fieldset>
        )}
      </div>

      {/* Course */}
      <fieldset className={styles.field}>
        <legend className={styles.legend}>{t("Course")}</legend>
        <select
          className={styles.input}
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          required
        >
          <option value="">{t("Select course...")}</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} {c.verified ? "" : ""}
              {!c.verified && <span className={styles.estimatedBadge}>{t("ESTIMATED")}</span>}
              {c.verified && c.source && <span className={styles.sourceText}>{t("CR verified: {source}", { source: c.source })}</span>}
            </option>
          ))}
        </select>
        {tee && (
          <div className={styles.teeInfo}>
            {tee.name} · {t("Par {n}", { n: tee.par })} · {t("CR {n}", { n: tee.cr })} · {t("Slope {n}", { n: tee.slope })}
          </div>
        )}
      </fieldset>

      {/* Players */}
      <fieldset className={styles.field}>
        <legend className={styles.legend}>{t("Players")}</legend>
        <div className={styles.playerGrid}>
          {friends.map((f) => {
            const id = f.userId || f.id || "";
            const name = f.display_name || f.displayName || id;
            return (
              <button
                key={id}
                type="button"
                className={`${styles.playerChip} ${selectedPlayers.includes(id) ? styles.playerChipActive : ""}`}
                onClick={() => togglePlayer(id)}
              >
                {name}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Scores */}
      {selectedPlayers.length > 0 && (
        <fieldset className={styles.field}>
          <legend className={styles.legend}>{scoreLabel}</legend>
          {format === "match" ? (
            <div className={styles.matchGrid}>
              {["self", ...selectedPlayers].map((pid) => {
                const name = pid === "self" ? t("My result") : getFriendName(pid);
                const parsed = matchParseResults?.[pid];
                return (
                  <div key={pid} className={styles.matchField}>
                    <label className={styles.scoreLabel}>{name}</label>
                    <div className={styles.chipRow}>
                      {MATCH_CHIPS.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          className={`${styles.matchChip} ${scores[pid] === chip ? styles.matchChipActive : ""}`}
                          onClick={() => setScores((prev) => ({ ...prev, [pid]: chip }))}
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      className={styles.input}
                      placeholder={t('Or type "3&2", "1 up", "Halved"')}
                      value={scores[pid] || ""}
                      onChange={(e) =>
                        setScores((prev) => ({ ...prev, [pid]: e.target.value }))
                      }
                    />
                    {parsed && (
                      <span className={styles.matchHint}>
                        {t("Won by {margin}", { margin: parsed.margin })}{parsed.holesPlayed < 18 ? t(", finished after {n} holes", { n: parsed.holesPlayed }) : ""}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.scoreGrid}>
              {["self", ...selectedPlayers].map((pid) => {
                const name = pid === "self" ? t("My score") : getFriendName(pid);
                return (
                  <div key={pid} className={styles.scoreField}>
                    <label className={styles.scoreLabel}>{name}</label>
                    <input
                      type="number"
                      className={styles.input}
                      placeholder={format === "stableford" ? "36" : "72"}
                      value={scores[pid] || ""}
                      onChange={(e) =>
                        setScores((prev) => ({ ...prev, [pid]: e.target.value }))
                      }
                      required
                    />
                  </div>
                );
              })}
            </div>
          )}
        </fieldset>
      )}

      {/* Actions */}
      <div className={styles.actions}>
        <button type="button" className={styles.cancelBtn} onClick={onCancel}>
          {t("Cancel")}
        </button>
        <button type="submit" className={styles.submitBtn} disabled={submitting}>
          {submitting ? t("Logging...") : t("Log Round")}
        </button>
      </div>
        </>
      )}
    </form>
  );
}
