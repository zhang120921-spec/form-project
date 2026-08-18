import { useState } from "react";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import styles from "./InviteModal.module.css";

interface Props {
  playerId: string;
  playerName: string;
  senderName: string;
  onClose: () => void;
  onSent?: () => void;
}

export default function InviteModal({
  playerId,
  playerName,
  senderName,
  onClose,
  onSent,
}: Props) {
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(today);
  const defaultMessage = senderName && senderName !== "I"
    ? t("{name} invites you to play golf", { name: senderName })
    : t("I invite you to play golf");
  const [message, setMessage] = useState(defaultMessage);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    setSending(true);
    setError("");
    try {
      await api.post("/play-invitations", {
        toId: playerId,
        proposedDate: date,
        message: message.trim(),
      });
      setSent(true);
      onSent?.();
      setTimeout(onClose, 1500);
    } catch (err: any) {
      setError(err?.message || t("Failed to send invitation"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{t("Invite {name}", { name: playerName })}</h3>
          <button className={styles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        {sent ? (
          <p className={styles.success}>{t("Invitation sent!")}</p>
        ) : (
          <>
            <label className={styles.field}>
              <span className={styles.label}>{t("Date")}</span>
              <input
                type="date"
                className={styles.input}
                value={date}
                min={today}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>{t("Message")}</span>
              <textarea
                className={styles.textarea}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
              />
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              <button
                className={styles.sendBtn}
                onClick={handleSend}
                disabled={sending || !date}
              >
                {sending ? t("Sending…") : t("Send invitation")}
              </button>
              <button className={styles.cancelBtn} onClick={onClose}>
                {t("Cancel")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
