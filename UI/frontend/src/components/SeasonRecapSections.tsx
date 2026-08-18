import { useMemo } from "react";
import styles from "./SeasonRecapSections.module.css";
import { t } from "@/lib/i18n";

interface Props {
  narrative: string;
}

type SectionKey = "form" | "results" | "matchups" | "outlook" | "bottomLine";
type SectionTitle = "Form" | "Results" | "Matchups" | "Outlook" | "Bottom line";

interface RecapSection {
  key: SectionKey;
  title: SectionTitle;
  bullets: string[];
}

const SECTION_ORDER: SectionKey[] = ["form", "results", "matchups", "outlook", "bottomLine"];

const SECTION_META: Record<
  SectionKey,
  { title: SectionTitle; color: "blue" | "green" | "orange" | "purple" | "brass" }
> = {
  form: { title: "Form", color: "blue" },
  results: { title: "Results", color: "green" },
  matchups: { title: "Matchups", color: "orange" },
  outlook: { title: "Outlook", color: "purple" },
  bottomLine: { title: "Bottom line", color: "brass" },
};

function cleanText(text: string): string {
  return text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

function splitIntoBullets(content: string): string[] {
  // Split on both ASCII periods and Chinese full-width periods (。)
  return content
    .split(/[.。](?:\s+|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length > 8)
    .map((s) => (s.endsWith(".") || s.endsWith("。") ? s : `${s}。`));
}

function detectSectionKey(label: string): SectionKey | null {
  const lower = label.toLowerCase();
  if (/\b(form|trend|trajectory)\b/.test(lower) || /状态|走势/.test(lower)) return "form";
  if (/\b(result|round|score|course|numbers|highlights?)\b/.test(lower) || /成绩|结果|最佳|数据/.test(lower)) return "results";
  if (/\b(matchup|opposition|rival|head-to-head|h2h|opponent)\b/.test(lower) || /对战|交锋|对阵|交手/.test(lower)) return "matchups";
  if (/\b(outlook|next|future|advice|takeaway|looking ahead|momentum)\b/.test(lower) || /展望|建议|未来|期待/.test(lower)) return "outlook";
  if (/\b(bottom.?line|summary|closing|verdict|final thought)\b/.test(lower) || /总结|结论|一句话|最终/.test(lower)) return "bottomLine";
  return null;
}

function parseRecapSections(narrative: string): RecapSection[] {
  const text = cleanText(narrative);
  if (!text) return [];

  // Match explicit labels like "Form:", "F (Form):", "**Form**:", "Bottom line:", "状态：", "对战："
  const pattern =
    /(?:^|\s)(?:\*\*)?(?:([A-Z])\s*\()?\b(Form|Results|Matchups|Outlook|Bottom line|Opposition|Rounds|Momentum|状态|成绩|对战|展望|总结)\b(?:\))?\s*(?::|—|：)(?:\*\*)?\s*/gim;

  const rawSections: Array<{ key: SectionKey | null; title: string; content: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let pending: { key: SectionKey | null; title: string; start: number } | null = null;

  while ((match = pattern.exec(text)) !== null) {
    if (pending) {
      rawSections.push({
        key: pending.key,
        title: pending.title,
        content: text.slice(pending.start, match.index),
      });
    }
    const label = match[2] || match[1] || "";
    const key = detectSectionKey(label);
    pending = { key, title: label, start: pattern.lastIndex };
    lastIndex = pattern.lastIndex;
  }

  if (pending) {
    rawSections.push({
      key: pending.key,
      title: pending.title,
      content: text.slice(pending.start),
    });
  }

  // Group by detected key, falling back to title-based ordering.
  const grouped = new Map<SectionKey, { title: SectionTitle; bullets: string[] }>();

  for (const section of rawSections) {
    const key = section.key;
    if (!key) continue;
    const bullets = splitIntoBullets(section.content);
    if (bullets.length === 0) continue;

    const existing = grouped.get(key);
    if (existing) {
      existing.bullets.push(...bullets);
    } else {
      grouped.set(key, {
        title: SECTION_META[key].title,
        bullets,
      });
    }
  }

  // If no structured sections were found, split sentences evenly across default sections.
  if (grouped.size === 0) {
    const allBullets = splitIntoBullets(text);
    if (allBullets.length === 0) return [];

    const chunkSize = Math.max(2, Math.ceil(allBullets.length / SECTION_ORDER.length));
    for (let i = 0; i < SECTION_ORDER.length; i++) {
      const key = SECTION_ORDER[i];
      const chunk = allBullets.slice(i * chunkSize, (i + 1) * chunkSize);
      if (chunk.length === 0) continue;
      grouped.set(key, { title: SECTION_META[key].title, bullets: chunk });
    }
  }

  return SECTION_ORDER
    .filter((key) => grouped.has(key))
    .map((key) => ({
      key,
      title: grouped.get(key)!.title,
      bullets: grouped.get(key)!.bullets,
    }));
}

function SectionIcon({ title }: { title: SectionTitle }) {
  switch (title) {
    case "Form":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case "Results":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
          <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
          <path d="M4 22h16" />
          <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
          <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
          <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
        </svg>
      );
    case "Matchups":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "Outlook":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12h5" />
          <path d="M17 12h5" />
          <circle cx="12" cy="12" r="5" />
          <path d="M12 2v5" />
          <path d="M12 17v5" />
        </svg>
      );
    case "Bottom line":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
          <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
        </svg>
      );
  }
}

export default function SeasonRecapSections({ narrative }: Props) {
  const sections = useMemo(() => parseRecapSections(narrative), [narrative]);
  const cleanFallback = useMemo(() => cleanText(narrative), [narrative]);

  if (sections.length === 0) {
    return (
      <div className={styles.container}>
        <p className={styles.fallback}>{cleanFallback}</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {sections.map((section, sectionIndex) => {
        const meta = SECTION_META[section.key];
        return (
          <article
            key={section.key}
            className={`${styles.recapSection} ${styles[`color${meta.color}`]}`}
            style={{ ["--section-index" as string]: sectionIndex }}
          >
            <div className={styles.sectionHeader}>
              <span className={styles.sectionIcon} aria-hidden="true">
                <SectionIcon title={section.title} />
              </span>
              <div className={styles.sectionTitleWrap}>
                <h3 className={styles.sectionTitle}>{t(section.title)}</h3>
                <span className={styles.sectionAccent} aria-hidden="true" />
              </div>
            </div>
            <ul className={styles.bulletList}>
              {section.bullets.map((bullet, bulletIndex) => (
                <li
                  key={bulletIndex}
                  className={styles.bullet}
                  style={{ ["--bullet-index" as string]: bulletIndex }}
                >
                  <span className={styles.bulletMarker} aria-hidden="true" />
                  <span className={styles.bulletText}>{bullet}</span>
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </div>
  );
}
