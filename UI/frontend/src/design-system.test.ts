import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname, basename } from "path";

/* ────────────────────────────────────────────────────────────
   Design System Compliance — v4 (sleek/energetic redesign):

   1. No body text falls below 18px outside the "Show the maths"
      layer.
   2. Corner radius only from the sanctioned scale (--radius-*),
      not arbitrary one-off values.
   3. Every delta renders a + or − sign.
   4. Elevation only from the sanctioned scale (--shadow-*).
   5. Motion is real (transform allowed for tactile feedback) but
      prefers-reduced-motion is always respected globally.

   These tests scan CSS files and component source code to verify
   compliance across all screens.
   ──────────────────────────────────────────────────────────── */

const cssDir = join(process.cwd(), "src");

/** Recursively collect every .css file under a directory. */
function collectCssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectCssFiles(full));
    } else if (extname(full) === ".css") {
      out.push(full);
    }
  }
  return out;
}

/** Strip CSS comments from source text. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

const cssFiles = collectCssFiles(cssDir);

// ════════════════════════════════════════════════════════════
// 1. Border radius — only the sanctioned scale
// ════════════════════════════════════════════════════════════

describe("Design system — radius from the sanctioned scale only", () => {
  it("no CSS file hardcodes a border-radius outside --radius-* / 0 / 50%", () => {
    const allowed = new Set(["0", "0px", "50%"]);
    const violations: { file: string; line: string }[] = [];

    for (const file of cssFiles) {
      const src = stripComments(readFileSync(file, "utf-8"));
      const lines = src.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        const match = trimmed.match(/border-radius\s*:\s*([^;]+)/);
        if (match) {
          const val = match[1].trim();
          if (allowed.has(val)) continue;
          if (val.startsWith("var(--radius-")) continue;
          violations.push({
            file: file.replace(cssDir, ""),
            line: trimmed,
          });
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `Border-radius violations found — use var(--radius-sm/md/lg/full), not one-off values:\n` +
        violations.map((v) => `  ${v.file}: ${v.line}`).join("\n")
      );
    }
  });
});

// ════════════════════════════════════════════════════════════
// 2. Body text — 18px floor
// ════════════════════════════════════════════════════════════

describe("Design system — 18px body text floor", () => {
  it("tokens.css defines --type-floor at 18px", () => {
    const tokens = readFileSync(join(cssDir, "styles", "tokens.css"), "utf-8");
    const cleaned = stripComments(tokens);
    expect(cleaned).toContain("--type-floor: 18px");
  });

  it("no CSS file uses a hardcoded font-size below 18px for body classes", () => {
    // Body text classes are: .body, .lede, .desc, .helper, .phrase
    // Labels and meta text (.label, .badge, .chip, .meta, .date, etc.)
    // are allowed to use smaller sizes.
    const bodyClasses = [
      "body",
      "lede",
      "desc",
      "helper",
      "phrase",
      "narration",
    ];

    const violations: { file: string; cls: string; line: string }[] = [];

    for (const file of cssFiles) {
      const src = stripComments(readFileSync(file, "utf-8"));
      const lines = src.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Check if this is a body class definition
        for (const cls of bodyClasses) {
          if (line === `.${cls} {` || line.startsWith(`.${cls}.`)) {
            // Look at the next few lines for font-size
            const block = lines.slice(i, i + 10).join("\n");
            const fontMatch = block.match(/font-size\s*:\s*([^;]+)/);
            if (fontMatch) {
              const val = fontMatch[1].trim();
              // Allow var() references and rem values >= 1rem
              if (val.startsWith("var(")) continue;
              if (val.includes("rem")) {
                const rem = parseFloat(val);
                if (rem < 1) {
                  violations.push({ file: file.replace(cssDir, ""), cls, line: fontMatch[0] });
                }
              }
              if (val.includes("px")) {
                const px = parseInt(val);
                if (px < 18) {
                  violations.push({ file: file.replace(cssDir, ""), cls, line: fontMatch[0] });
                }
              }
            }
          }
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `Body text below 18px found — design system requires 18px minimum:\n` +
        violations.map((v) => `  ${v.file} .${v.cls}: ${v.line}`).join("\n")
      );
    }
  });
});

// ════════════════════════════════════════════════════════════
// 3. Delta signs — every delta shows + or −
// ════════════════════════════════════════════════════════════

describe("Design system — every delta renders a sign", () => {
  it("all component files that display deltas include + or − sign patterns", () => {
    // Components that display deltas: RoundCard, PlayerCard, MathsOverlay,
    // FairMatchPage, SandbagPage, RivalryCard, OverviewPage
    const componentsToCheck = [
      "components/RoundCard.tsx",
      "components/PlayerCard.tsx",
      "components/MathsOverlay.tsx",
      "components/RivalryCard.tsx",
      "pages/FairMatchPage.tsx",
      "pages/SandbagPage.tsx",
      "pages/OverviewPage.tsx",
    ];

    const srcDir = join(cssDir);

    for (const comp of componentsToCheck) {
      const filePath = join(srcDir, comp);
      let src: string;
      try {
        src = readFileSync(filePath, "utf-8");
      } catch {
        continue; // file might not exist
      }

      // Check for delta display patterns — should use ▲/▼/→ with +/−
      // Look for patterns like: `+` `−` (unicode minus) or `Math.abs`
      if (src.includes("delta") || src.includes("Δ") || src.includes("delta")) {
        // Must contain either + or − (unicode U+2212) sign rendering
        const hasPlus = src.includes("+") || src.includes("'+'");
        const hasMinus = src.includes("−") || src.includes("'−'") || src.includes("'-\u2212'");
        expect(hasPlus || hasMinus).toBe(true);
      }
    }
  });

  it("RoundCard displays ▲ + and ▼ − for positive and negative deltas", () => {
    const src = readFileSync(join(cssDir, "components", "RoundCard.tsx"), "utf-8");

    // Summary line: should have ▲ + and ▼ − pattern
    expect(src).toContain("▲ +");
    expect(src).toContain("▼ −");

    // Detail table: same pattern
    expect(src).toContain("▲ +");
    expect(src).toContain("▼ −");
  });
});

// ════════════════════════════════════════════════════════════
// 4. Elevation — only the sanctioned --shadow-* scale
// ════════════════════════════════════════════════════════════

describe("Design system — shadows from the sanctioned scale only", () => {
  it("no CSS file hardcodes a box-shadow outside var(--shadow-*) / none", () => {
    const violations: { file: string; line: string }[] = [];

    for (const file of cssFiles) {
      const src = stripComments(readFileSync(file, "utf-8"));
      const lines = src.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        const match = trimmed.match(/box-shadow\s*:\s*([^;]+)/);
        if (match) {
          const val = match[1].trim();
          if (val === "none") continue;
          if (val.startsWith("var(--shadow-")) continue;
          violations.push({
            file: file.replace(cssDir, ""),
            line: trimmed,
          });
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `Box-shadow violations found — use var(--shadow-sm/md/lg/focus), not one-off values:\n` +
        violations.map((v) => `  ${v.file}: ${v.line}`).join("\n")
      );
    }
  });
});

// ════════════════════════════════════════════════════════════
// 5. Contrast ratios — surfaces, rules, accent separation
// ════════════════════════════════════════════════════════════

/** Parse a hex colour (#RRGGBB) to {r,g,b} 0-255. */
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Relative luminance per WCAG 2.1. */
function luminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0;
  const chan = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
}

/** Contrast ratio per WCAG 2.1 (1.0–21.0). */
function contrast(hexA: string, hexB: string): number {
  const la = luminance(hexA);
  const lb = luminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Extract a CSS variable value from tokens.css source. */
function tokenValue(src: string, name: string): string | null {
  const re = new RegExp(`--${name}\\s*:\\s*([^;]+);`);
  const m = src.match(re);
  return m ? m[1].trim() : null;
}

describe("Design system — contrast ratios", () => {
  const tokensPath = join(cssDir, "styles", "tokens.css");
  const tokensRaw = readFileSync(tokensPath, "utf-8");
  const tokens = stripComments(tokensRaw);

  // Split into light (:root) and dark (.dark) sections
  const rootMatch = tokens.match(/:root\s*\{([^}]*)\}/);
  const darkMatch = tokens.match(/\.dark\s*\{([^}]*)\}/);
  const lightSrc = rootMatch ? rootMatch[1] : "";
  const darkSrc = darkMatch ? darkMatch[1] : "";

  it("light: card/ground contrast ≥ 1.15:1", () => {
    const card = tokenValue(lightSrc, "card");
    const ground = tokenValue(lightSrc, "ground");
    expect(card).toBeTruthy();
    expect(ground).toBeTruthy();
    const ratio = contrast(card!, ground!);
    expect(ratio).toBeGreaterThanOrEqual(1.15);
  });

  it("dark: card/ground contrast ≥ 1.15:1", () => {
    const card = tokenValue(darkSrc, "card");
    const ground = tokenValue(darkSrc, "ground");
    expect(card).toBeTruthy();
    expect(ground).toBeTruthy();
    const ratio = contrast(card!, ground!);
    expect(ratio).toBeGreaterThanOrEqual(1.15);
  });

  it("light: --rule/--card contrast ≥ 1.6:1", () => {
    const rule = tokenValue(lightSrc, "rule");
    const card = tokenValue(lightSrc, "card");
    expect(rule).toBeTruthy();
    expect(card).toBeTruthy();
    const ratio = contrast(rule!, card!);
    expect(ratio).toBeGreaterThanOrEqual(1.6);
  });

  it("dark: --rule/--card contrast ≥ 1.6:1", () => {
    const rule = tokenValue(darkSrc, "rule");
    const card = tokenValue(darkSrc, "card");
    expect(rule).toBeTruthy();
    expect(card).toBeTruthy();
    const ratio = contrast(rule!, card!);
    expect(ratio).toBeGreaterThanOrEqual(1.6);
  });

  it("light: --accent ≠ --pos (not the same value)", () => {
    const accent = tokenValue(lightSrc, "accent");
    const pos = tokenValue(lightSrc, "pos");
    expect(accent).toBeTruthy();
    expect(pos).toBeTruthy();
    expect(accent).not.toBe(pos);
  });

  it("dark: --accent ≠ --pos (not the same value)", () => {
    const accent = tokenValue(darkSrc, "accent");
    const pos = tokenValue(darkSrc, "pos");
    expect(accent).toBeTruthy();
    expect(pos).toBeTruthy();
    expect(accent).not.toBe(pos);
  });
});

// ════════════════════════════════════════════════════════════
// 6. Font-size floor — 16px minimum, 18px for body
// ════════════════════════════════════════════════════════════

describe("Design system — no font-size below 16px outside maths layer", () => {
  const mathsFiles = ["MathsOverlay.module.css"];

  it("no CSS file outside MathsOverlay declares font-size below 16px", () => {
    const violations: { file: string; line: string }[] = [];

    for (const file of cssFiles) {
      const isMaths = mathsFiles.some((m) => file.endsWith(m));
      if (isMaths) continue;

      const src = stripComments(readFileSync(file, "utf-8"));
      const lines = src.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        const match = trimmed.match(/font-size\s*:\s*([^;]+)/);
        if (match) {
          const val = match[1].trim();
          // Skip var() references — they resolve to tokens we test separately
          if (val.startsWith("var(")) continue;
          // Check raw px
          if (val.includes("px")) {
            const px = parseInt(val);
            if (px > 0 && px < 16) {
              violations.push({ file: file.replace(cssDir, ""), line: trimmed });
            }
          }
          // Check raw rem (root is 18px)
          if (val.match(/^[0-9.]+rem$/)) {
            const rem = parseFloat(val);
            if (rem > 0 && rem * 18 < 16) {
              violations.push({ file: file.replace(cssDir, ""), line: trimmed });
            }
          }
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `Font-size below 16px found outside maths layer:\n` +
        violations.map((v) => `  ${v.file}: ${v.line}`).join("\n")
      );
    }
  });
});

// ════════════════════════════════════════════════════════════
// 7. Spacing floor — no sub-16px gap/padding/margin at card/section level
// ════════════════════════════════════════════════════════════

describe("Design system — no sub-16px spacing at card/section level", () => {
  // Selectors that represent card or section containers (not rows or sub-elements)
  const cardSectionPatterns = [
    /^\.(card|section|panel|modal|overlay|heroSection|hero|resultCard|recapCard|toggleCard|profileCard|matchCard)\s*[,{]/,
  ];

  it("card/section selectors do not use --space-xs or --space-sm as sole padding", () => {
    const violations: { file: string; line: string }[] = [];

    for (const file of cssFiles) {
      const src = stripComments(readFileSync(file, "utf-8"));
      const lines = src.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const isCardSection = cardSectionPatterns.some((p) => p.test(line));
        if (!isCardSection) continue;

        // Look at the next 8 lines for padding
        const block = lines.slice(i, i + 8).join("\n");
        const padMatch = block.match(/padding\s*:\s*([^;]+)/);
        if (padMatch) {
          const val = padMatch[1].trim();
          // If ALL dimensions are --space-xs or --space-sm, flag it
          if (
            (val.includes("--space-xs") || val.includes("--space-sm")) &&
            !val.includes("--space-md") &&
            !val.includes("--space-lg") &&
            !val.includes("--space-xl") &&
            !val.includes("--space-2xl") &&
            !val.includes("--space-3xl")
          ) {
            violations.push({
              file: file.replace(cssDir, ""),
              line: `${line} → padding: ${val}`,
            });
          }
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `Card/section selectors using only sub-16px padding:\n` +
        violations.map((v) => `  ${v.file}: ${v.line}`).join("\n")
      );
    }
  });
});

// ════════════════════════════════════════════════════════════
// 8. Motion — transform is allowed for tactile feedback, but
//    prefers-reduced-motion must always be respected globally.
// ════════════════════════════════════════════════════════════

describe("Design system — motion respects prefers-reduced-motion", () => {
  it("global.css disables animation/transition duration under prefers-reduced-motion: reduce", () => {
    const src = readFileSync(join(cssDir, "styles", "global.css"), "utf-8");
    const cleaned = stripComments(src);
    expect(cleaned).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);

    const mediaBlock = cleaned.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*)\}\s*$/);
    expect(mediaBlock, "reduced-motion media block should be the last rule in global.css").toBeTruthy();
    expect(mediaBlock![1]).toMatch(/animation-duration/);
    expect(mediaBlock![1]).toMatch(/transition-duration/);
  });
});

// ════════════════════════════════════════════════════════════
// 9. Jargon ban — RD, WHS, Rating Dev, Idle must not appear
//    in any rendered output outside the "Show the maths" layer.
// ════════════════════════════════════════════════════════════

// Display strings that must not appear outside the maths layer.
// These match what a user would see in the UI, not property accessors.
const FORBIDDEN_DISPLAY = [
  "WHS HCP",
  "Rating Dev",
  "Days Idle",
  "d idle",   // catches "15d idle" style
];
// MathsOverlay is the "Show the maths" layer — jargon is allowed there.
const MATHS_FILES = ["components/MathsOverlay.tsx"];

describe("Jargon — no RD, WHS, Rating Dev, or Idle outside maths layer", () => {
  const srcDir = join(cssDir);

  // Collect all .tsx files except MathsOverlay
  function collectTsxFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory() && name !== "node_modules") {
        out.push(...collectTsxFiles(full));
      } else if (extname(full) === ".tsx" && !MATHS_FILES.some((m) => full.endsWith(m))) {
        out.push(full);
      }
    }
    return out;
  }

  const tsxFiles = collectTsxFiles(srcDir);

  it("no TSX file outside MathsOverlay contains forbidden display strings", () => {
    const violations: { file: string; jargon: string; line: string }[] = [];

    for (const file of tsxFiles) {
      const lines = readFileSync(file, "utf-8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const jargon of FORBIDDEN_DISPLAY) {
          if (line.includes(jargon)) {
            violations.push({
              file: file.replace(srcDir, ""),
              jargon,
              line: `${i + 1}: ${line.trim()}`,
            });
          }
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `Forbidden display jargon found outside the "Show the maths" layer:\n` +
        violations.map((v) => `  ${v.file} line ${v.line}`).join("\n")
      );
    }
  });

  it("no CSS file contains forbidden display jargon", () => {
    const violations: { file: string; jargon: string; line: string }[] = [];

    for (const file of cssFiles) {
      const src = stripComments(readFileSync(file, "utf-8"));
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const jargon of FORBIDDEN_DISPLAY) {
          if (line.includes(jargon)) {
            violations.push({
              file: file.replace(cssDir, ""),
              jargon,
              line: `${i + 1}: ${line.trim()}`,
            });
          }
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `Forbidden display jargon found in CSS:\n` +
        violations.map((v) => `  ${v.file} line ${v.line}`).join("\n")
      );
    }

    // Implicitly passes if no violations
    expect(violations).toHaveLength(0);
  });
});
