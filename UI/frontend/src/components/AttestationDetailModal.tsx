import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Attestation, ReplayResult } from "@/lib/types";
import styles from "./AttestationDetailModal.module.css";
import { t } from "@/lib/i18n";

interface RoundParticipant {
  player_id: string;
  player_name: string;
  ags?: number | null;
  holes_won?: number | null;
  points?: number | null;
  cr: number;
  slope: number;
  pcc?: number | null;
}

interface RoundDetail {
  id: string;
  date: string;
  format: "stroke" | "match" | "stableford";
  course: string;
  par?: number;
  holes?: number;
  nine?: string;
  logged_by: string;
  logged_by_name: string;
  participants: RoundParticipant[];
}

interface ParticipantInput {
  playerId: string;
  ags?: number;
  holesWon?: number;
  points?: number;
}

interface Props {
  attestation: Attestation;
  replayData?: ReplayResult | null;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  onDispute: (participants: ParticipantInput[]) => void | Promise<void>;
}

function formatDate(dateStr: string) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatFormat(format: string) {
  if (format === "stroke") return t("Stroke play");
  if (format === "match") return t("Match play");
  if (format === "stableford") return t("Stableford");
  return format || "—";
}

function scoreLabel(format: string) {
  if (format === "match") return t("Holes won");
  if (format === "stableford") return t("Points");
  return t("Strokes");
}

function getScore(p: RoundParticipant, format: string) {
  if (format === "match") return p.holes_won ?? 0;
  if (format === "stableford") return p.points ?? 0;
  return p.ags ?? 0;
}

export default function AttestationDetailModal({
  attestation,
  replayData,
  onClose,
  onConfirm,
  onDispute,
}: Props) {
  const [round, setRound] = useState<RoundDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedScores, setEditedScores] = useState<Record<string, number>>({});
  const [actionLoading, setActionLoading] = useState<"confirm" | "dispute" | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const data = await api.get<RoundDetail>(`/rounds/${attestation.roundId ?? attestation.round_id}`);
        if (cancelled) return;
        setRound(data);
        const initial: Record<string, number> = {};
        for (const p of data.participants) {
          initial[p.player_id] = getScore(p, data.format);
        }
        setEditedScores(initial);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : t("Failed to load round details"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [attestation.roundId, attestation.round_id]);

  const replayRound = useMemo(() => {
    if (!round || !replayData) return null;
    return replayData.rounds.find((r) => r.id === round.id) ?? null;
  }, [round, replayData]);

  const snapshotByPlayer = useMemo(() => {
    if (!replayRound) return new Map<string, { before: number; after: number; delta: number }>();
    return new Map(replayRound.snapshot.map((s) => [s.playerId, s]));
  }, [replayRound]);

  async function handleConfirm() {
    setActionLoading("confirm");
    try {
      await onConfirm();
      onClose();
    } finally {
      setActionLoading(null);
    }
  }

  async function handleStartDispute() {
    setIsEditing(true);
  }

  async function handleSubmitDispute() {
    if (!round) return;
    setActionLoading("dispute");
    try {
      const participants: ParticipantInput[] = round.participants.map((p) => ({
        playerId: p.player_id,
        ...(round.format === "match"
          ? { holesWon: editedScores[p.player_id] ?? 0 }
          : round.format === "stableford"
          ? { points: editedScores[p.player_id] ?? 0 }
          : { ags: editedScores[p.player_id] ?? 0 }),
      }));
      await onDispute(participants);
      onClose();
    } finally {
      setActionLoading(null);
    }
  }

  function handleCancelEdit() {
    if (!round) return;
    const reset: Record<string, number> = {};
    for (const p of round.participants) {
      reset[p.player_id] = getScore(p, round.format);
    }
    setEditedScores(reset);
    setIsEditing(false);
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{t("Round Details")}</h3>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          {loading && <p className={styles.empty}>{t("Loading round details…")}</p>}
          {error && <p className={styles.error}>{error}</p>}

          {!loading && !error && round && (
            <>
              <div className={styles.meta}>
                <p className={styles.lede}>
                  <strong>{attestation.fromName || round.logged_by_name || t("A friend")}</strong> {t("logged a round with you")}
                </p>
                <div className={styles.metaGrid}>
                  <div>
                    <span className={styles.metaLabel}>{t("Course")}</span>
                    <span className={styles.metaValue}>{round.course}</span>
                  </div>
                  <div>
                    <span className={styles.metaLabel}>{t("Date")}</span>
                    <span className={styles.metaValue}>{formatDate(round.date)}</span>
                  </div>
                  <div>
                    <span className={styles.metaLabel}>{t("Format")}</span>
                    <span className={styles.metaValue}>{formatFormat(round.format)}</span>
                  </div>
                  {(round.par || round.holes) && (
                    <div>
                      <span className={styles.metaLabel}>{t("Details")}</span>
                      <span className={styles.metaValue}>
                        {round.par ? t("Par {n}", { n: round.par }) : ""}
                        {round.par && round.holes ? " · " : ""}
                        {round.holes ? t("{n} holes", { n: round.holes }) : ""}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>{t("Player")}</th>
                      <th>{scoreLabel(round.format)}</th>
                      <th>{t("Before")}</th>
                      <th>{t("After")}</th>
                      <th>{t("Change")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {round.participants.map((p) => {
                      const snap = snapshotByPlayer.get(p.player_id);
                      const isYou = p.player_id === attestation.toId || p.player_id === attestation.to_id;
                      return (
                        <tr key={p.player_id}>
                          <td className={styles.playerCell}>
                            {p.player_name || t("Unknown")}
                            {isYou && <span className={styles.youTag}>{t("You")}</span>}
                          </td>
                          <td>
                            {isEditing ? (
                              <input
                                type="number"
                                className={styles.scoreInput}
                                value={editedScores[p.player_id] ?? ""}
                                onChange={(e) =>
                                  setEditedScores((prev) => ({
                                    ...prev,
                                    [p.player_id]: Number(e.target.value),
                                  }))
                                }
                                min={0}
                                step={round.format === "stroke" ? 1 : 1}
                              />
                            ) : (
                              getScore(p, round.format)
                            )}
                          </td>
                          <td>{snap ? Math.round(snap.before) : "—"}</td>
                          <td>{snap ? Math.round(snap.after) : "—"}</td>
                          <td className={snap && snap.delta > 0 ? styles.pos : snap && snap.delta < 0 ? styles.neg : ""}>
                            {snap ? `${snap.delta > 0 ? "+" : ""}${Math.round(snap.delta)}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!replayRound && (
                <p className={styles.note}>
                  {t("ELO changes will be calculated once the round is confirmed.")}
                </p>
              )}
            </>
          )}
        </div>

        <div className={styles.actions}>
          {!isEditing ? (
            <>
              <button
                className={styles.secondaryBtn}
                onClick={handleStartDispute}
                disabled={loading || !!error || actionLoading === "confirm"}
              >
                {t("Dispute")}
              </button>
              <button
                className={styles.primaryBtn}
                onClick={handleConfirm}
                disabled={loading || !!error || actionLoading === "dispute"}
              >
                {actionLoading === "confirm" ? t("Accepting…") : t("Accept")}
              </button>
            </>
          ) : (
            <>
              <button
                className={styles.secondaryBtn}
                onClick={handleCancelEdit}
                disabled={actionLoading === "dispute"}
              >
                {t("Cancel")}
              </button>
              <button
                className={styles.primaryBtn}
                onClick={handleSubmitDispute}
                disabled={actionLoading === "dispute"}
              >
                {actionLoading === "dispute" ? t("Sending…") : t("Submit dispute")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
