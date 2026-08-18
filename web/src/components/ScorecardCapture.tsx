import { useState, useRef, useCallback } from "react";
import type { FriendInfo, Course } from "@/lib/types";
import { getToken } from "@/lib/api";
import { t } from "@/lib/i18n";
import {
  parseVoiceInput,
  validateDraft,
  type ScorecardDraft,
  type ScoreField,
} from "@/lib/scorecard-capture";
import styles from "./ScorecardCapture.module.css";

interface Props {
  friends: FriendInfo[];
  courses: Course[];
  onCommit: (draft: ScorecardDraft) => void;
  onCancel: () => void;
}

type Tab = "photo" | "voice";

export default function ScorecardCapture({ friends, courses, onCommit, onCancel }: Props) {
  const [tab, setTab] = useState<Tab>("voice");
  const [draft, setDraft] = useState<ScorecardDraft | null>(null);
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrFallback, setOcrFallback] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [committed, setCommitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Voice recognition ──────────────────────────────────
  const startListening = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      // Fallback: let user type the transcript
      setListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      setTranscript(text);
      const parsed = parseVoiceInput(text, friends);
      setDraft(parsed);
    };

    recognition.start();
  }, [friends]);

  // ── Photo capture + OCR ─────────────────────────────────
  const handlePhoto = useCallback(
    async (file: File) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        setPhotoPreview(dataUrl);
        setOcrLoading(true);
        setOcrError(null);
        setOcrFallback(null);

        try {
          const formData = new FormData();
          formData.append("image", file);

          const res = await fetch("/api/ai/ocr-scorecard", {
            method: "POST",
            headers: getToken()
              ? { Authorization: `Bearer ${getToken()}` }
              : {},
            body: formData,
          });

          const data = await res.json();

          if (data.fallback) {
            setOcrFallback(data.message || t("AI not configured. Use manual entry."));
            setOcrLoading(false);
            return;
          }

          // Build draft from OCR result: { players: [{ name, holes, total }], course, date }
          const fields: ScoreField[] = (data.players || []).map(
            (p: { name: string; holes?: (number | null)[]; total?: number }) => {
              // Match name against friends
              const rawName = p.name || "";
              let matchedFriendId: string | null = null;
              let nameConfidence = 0;
              let unmatched = true;

              const cleaned = rawName.toLowerCase().trim();
              for (const f of friends) {
                const fname = (f.displayName ?? f.display_name ?? "").toLowerCase();
                if (fname === cleaned) {
                  matchedFriendId = f.userId ?? f.id ?? null;
                  nameConfidence = 1.0;
                  unmatched = false;
                  break;
                }
                if (fname.includes(cleaned) || cleaned.includes(fname)) {
                  matchedFriendId = f.userId ?? f.id ?? null;
                  nameConfidence = 0.6;
                  unmatched = false;
                }
              }

              return {
                rawName,
                matchedFriendId,
                ags: p.total ?? null,
                nameConfidence,
                scoreConfidence: p.total != null ? 0.85 : 0,
                holeScores: p.holes ?? null,
                unmatched,
              };
            }
          );

          setDraft({
            fields,
            courseName: data.course ?? null,
            courseConfidence: data.course ? 0.8 : 0,
            format: null,
            photoDataUrl: dataUrl,
          });
        } catch {
          setOcrError(t("Could not read the scorecard. Use manual entry."));
        } finally {
          setOcrLoading(false);
        }
      };
      reader.readAsDataURL(file);
    },
    [friends]
  );

  // ── Manual transcript parse ─────────────────────────────
  const parseManualTranscript = () => {
    if (!transcript.trim()) return;
    const parsed = parseVoiceInput(transcript, friends);
    setDraft(parsed);
  };

  // ── Field editing ───────────────────────────────────────
  const updateField = (index: number, updates: Partial<ScoreField>) => {
    if (!draft) return;
    const fields = [...draft.fields];
    fields[index] = { ...fields[index], ...updates };
    setDraft({ ...draft, fields });
  };

  const addField = () => {
    if (!draft) return;
    setDraft({
      ...draft,
      fields: [
        ...draft.fields,
        {
          rawName: "",
          matchedFriendId: null,
          ags: null,
          nameConfidence: 0,
          scoreConfidence: 0,
          unmatched: true,
        },
      ],
    });
  };

  const removeField = (index: number) => {
    if (!draft) return;
    setDraft({
      ...draft,
      fields: draft.fields.filter((_, i) => i !== index),
    });
  };

  // ── Validation ──────────────────────────────────────────
  const validation = draft ? validateDraft(draft) : null;
  const canCommit = validation?.canCommit ?? false;

  // ── Commit ──────────────────────────────────────────────
  const handleCommit = () => {
    if (!draft || !canCommit) return;
    setConfirming(true);
    setCommitted(true);
    onCommit(draft);
  };

  // ── Render ──────────────────────────────────────────────
  return (
    <div className={styles.container}>
      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === "photo" ? styles.tabActive : ""}`}
          onClick={() => setTab("photo")}
        >
          {t("Photo")}
        </button>
        <button
          className={`${styles.tab} ${tab === "voice" ? styles.tabActive : ""}`}
          onClick={() => setTab("voice")}
        >
          {t("Voice")}
        </button>
      </div>

      {/* Photo tab */}
      {tab === "photo" && (
        <div className={styles.tabContent}>
          <p className={styles.helper}>
            {t("Photograph a paper scorecard. We'll read the scores — you confirm each one.")}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className={styles.fileInput}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handlePhoto(file);
            }}
          />
          {photoPreview && (
            <div className={styles.photoPreview}>
              <img src={photoPreview} alt={t("Scorecard")} className={styles.photo} />
              {ocrLoading && (
                <p className={styles.ocrLoading}>{t("Reading scorecard…")}</p>
              )}
              {ocrError && (
                <p className={styles.ocrError}>{ocrError}</p>
              )}
              {ocrFallback && (
                <p className={styles.ocrFallback}>{ocrFallback}</p>
              )}
              {!ocrLoading && !ocrError && !ocrFallback && (
                <p className={styles.photoNote}>
                  {t("Scorecard captured. The original photo will be attached to the round for dispute resolution.")}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Voice tab */}
      {tab === "voice" && (
        <div className={styles.tabContent}>
          <p className={styles.helper}>
            {t("Speak the round: \"Michael 78, Darren 81, Wei 88 at Serapong\"")}
          </p>
          <div className={styles.voiceControls}>
            <button
              className={`${styles.micBtn} ${listening ? styles.micActive : ""}`}
              onClick={startListening}
              disabled={listening}
            >
              {listening ? t("Listening…") : t("Start speaking")}
            </button>
          </div>
          <textarea
            className={styles.transcript}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={t("Or type the round here…")}
            rows={2}
          />
          {transcript && !draft && (
            <button className={styles.parseBtn} onClick={parseManualTranscript}>
              {t("Parse")}
            </button>
          )}
        </div>
      )}

      {/* Draft review */}
      {draft && (
        <div className={styles.draft}>
          <h3 className={styles.draftTitle}>{t("Review each field")}</h3>
          <p className={styles.draftHelper}>
            {t("Confirm every field before committing. Fields with low confidence are highlighted.")}
          </p>

          {draft.fields.map((field, i) => {
            const errors = validation?.errors.filter((e) => e.fieldIndex === i) ?? [];
            const hasError = errors.length > 0;
            const lowConf = field.nameConfidence < 0.7 || field.scoreConfidence < 0.7;

            return (
              <div
                key={i}
                className={`${styles.fieldRow} ${hasError ? styles.fieldError : lowConf ? styles.fieldWarn : ""}`}
              >
                <div className={styles.fieldInputs}>
                  <select
                    className={styles.fieldSelect}
                    value={field.matchedFriendId ?? ""}
                    onChange={(e) => {
                      const friend = friends.find(
                        (f) => (f.userId ?? f.id) === e.target.value
                      );
                      updateField(i, {
                        matchedFriendId: e.target.value || null,
                        rawName: friend?.displayName ?? friend?.display_name ?? field.rawName,
                        unmatched: !e.target.value,
                        nameConfidence: e.target.value ? 1.0 : 0,
                      });
                    }}
                  >
                    <option value="">
                      {field.unmatched ? t("Pick: {name}", { name: field.rawName }) : t("Select player…")}
                    </option>
                    {friends.map((f) => {
                      const id = f.userId ?? f.id ?? "";
                      const name = f.displayName ?? f.display_name ?? "";
                      return (
                        <option key={id} value={id}>{name}</option>
                      );
                    })}
                  </select>

                  <input
                    type="number"
                    className={styles.scoreInput}
                    value={field.ags ?? ""}
                    onChange={(e) =>
                      updateField(i, {
                        ags: e.target.value ? parseInt(e.target.value, 10) : null,
                        scoreConfidence: 1.0,
                      })
                    }
                    placeholder={t("AGS")}
                  />

                  <button
                    className={styles.removeBtn}
                    onClick={() => removeField(i)}
                    title={t("Remove")}
                  >
                    ✕
                  </button>
                </div>

                {/* Confidence indicators */}
                <div className={styles.confidenceRow}>
                  {field.nameConfidence < 1.0 && (
                    <span className={styles.confBadge}>
                      {t("Name: {n}%", { n: Math.round(field.nameConfidence * 100) })}
                    </span>
                  )}
                  {field.scoreConfidence < 1.0 && (
                    <span className={styles.confBadge}>
                      {t("Score: {n}%", { n: Math.round(field.scoreConfidence * 100) })}
                    </span>
                  )}
                  {errors.map((err, j) => (
                    <span key={j} className={styles.errorMsg}>{err.message}</span>
                  ))}
                </div>
              </div>
            );
          })}

          <button className={styles.addBtn} onClick={addField}>
            {t("+ Add player")}
          </button>

          {/* Course selection */}
          <div className={styles.courseRow}>
            <select
              className={styles.fieldSelect}
              value={draft.courseName ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, courseName: e.target.value || null, courseConfidence: 1.0 })
              }
            >
              <option value="">{t("Select course…")}</option>
              {courses.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
            <select
              className={styles.fieldSelect}
              value={draft.format ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, format: e.target.value as ScorecardDraft["format"] })
              }
            >
              <option value="">{t("Format…")}</option>
              <option value="stroke">{t("Stroke")}</option>
              <option value="stableford">{t("Stableford")}</option>
              <option value="match">{t("Match play")}</option>
            </select>
          </div>

          {/* Commit */}
          <div className={styles.commitRow}>
            <button className={styles.cancelBtn} onClick={onCancel}>
              {t("Cancel")}
            </button>
            <button
              className={`${styles.commitBtn} ${!canCommit ? styles.commitDisabled : ""}`}
              onClick={handleCommit}
              disabled={!canCommit || committed}
            >
              {committed ? t("Committed") : t("Confirm & commit")}
            </button>
          </div>
          {!canCommit && validation && validation.errors.length > 0 && (
            <p className={styles.commitWarning}>
              {t("{n} fields need attention before you can commit.", { n: validation.errors.length })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
