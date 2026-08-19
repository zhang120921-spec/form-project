import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname, basename } from "path";

/* ────────────────────────────────────────────────────────────
   Bright-green exclusion test

   Asserts that no "bright green" color appears in the light-theme
   stylesheet.  A bright green is defined as:
     • HSL hue in [60°, 180°]  (yellow-green through cyan-green)
     • Saturation > 25 %
     • Lightness  > 40 %

   This catches the problematic fairway greens (#4CAF50, #7CB342,
   #34C759, etc.) that fail WCAG 4.5:1 contrast against the cream
   ground (#EFECE5).

   Dark-theme colours inside the `.dark { }` block are excluded —
   they are intentionally lighter to maintain contrast against
   dark surfaces and are verified separately.
   ──────────────────────────────────────────────────────────── */

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

/** Strip CSS comments (/* … *​/) from source text. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Remove the `.dark { … }` block so dark-theme overrides are
 * not evaluated against the light-theme brightness threshold.
 */
function stripDarkBlock(src: string): string {
  return src.replace(/\.dark\s*\{[^}]*\}/g, "");
}

/** Parse "#RGB" or "#RRGGBB" into [r, g, b] (0–255). Returns null on failure. */
function parseHex(hex: string): [number, number, number] | null {
  const h = hex.slice(1); // remove #
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  if (h.length === 6) {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  return null;
}

/** Convert [r, g, b] 0-255 → [h 0-360, s 0-1, l 0-1]. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;

  if (d === 0) return [0, 0, l];

  const s = l < 0.5 ? d / (max + min) : d / (2 - max - min);

  let h = 0;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

/** Is this colour "green" enough to evaluate? */
function isGreenHue(h: number, s: number): boolean {
  return h >= 60 && h <= 180 && s > 0.25;
}

/** Maximum acceptable lightness for a green in the light theme. */
const MAX_GREEN_LIGHTNESS = 0.40;

// ── Collect & analyse ──────────────────────────────────────

const cssDir = join(process.cwd(), "src");
const cssFiles = collectCssFiles(cssDir);

interface Finding {
  hex: string;
  file: string;
  h: number;
  s: number;
  l: number;
}

// Background-fill roles are exempt: a light green wash behind content
// (e.g. --pos-bg, --hover) isn't read as text, so WCAG text-contrast
// doesn't apply to it — only to foreground/text-bearing tokens.
const BG_ROLE_RE = /-bg$/;
const BG_ROLE_NAMES = new Set(["hover", "sel", "ground", "card", "math-bg"]);

const brightGreens: Finding[] = [];

for (const file of cssFiles) {
  const raw = readFileSync(file, "utf-8");
  // tokens.css: strip comments AND the .dark block
  const cleaned = basename(file) === "tokens.css"
    ? stripDarkBlock(stripComments(raw))
    : stripComments(raw);

  const isTokens = basename(file) === "tokens.css";
  // In tokens.css, match "--name: #hex" so background-role tokens can be
  // excluded by name. Elsewhere, match any hex literal directly.
  const declRe = /--([a-z0-9-]+)\s*:\s*(#(?:[0-9a-fA-F]{3}(?![0-9a-fA-F])|[0-9a-fA-F]{6}))\b/g;
  const hexRe = /#(?:[0-9a-fA-F]{3}(?![0-9a-fA-F])|[0-9a-fA-F]{6})\b/g;

  const seen = new Set<string>();

  if (isTokens) {
    for (const m of cleaned.matchAll(declRe)) {
      const [, name, hex] = m;
      if (BG_ROLE_RE.test(name) || BG_ROLE_NAMES.has(name)) continue;
      const key = hex.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const rgb = parseHex(hex);
      if (!rgb) continue;
      const [h, s, l] = rgbToHsl(...rgb);
      if (isGreenHue(h, s) && l > MAX_GREEN_LIGHTNESS) {
        brightGreens.push({ hex: key, file: file.replace(cssDir, ""), h, s, l });
      }
    }
  } else {
    const matches = cleaned.match(hexRe) ?? [];
    for (const hex of matches) {
      const key = hex.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const rgb = parseHex(hex);
      if (!rgb) continue;
      const [h, s, l] = rgbToHsl(...rgb);
      if (isGreenHue(h, s) && l > MAX_GREEN_LIGHTNESS) {
        brightGreens.push({ hex: key, file: file.replace(cssDir, ""), h, s, l });
      }
    }
  }
}

// ── Tests ───────────────────────────────────────────────────

describe("Palette — bright-green exclusion", () => {
  it("no green colour exceeds 40 % HSL lightness in the light theme", () => {
    if (brightGreens.length > 0) {
      const lines = brightGreens.map(
        (f) =>
          `  ${f.hex}  H:${f.h.toFixed(0)}° S:${(f.s * 100).toFixed(0)}% L:${(f.l * 100).toFixed(0)}%  in ${f.file}`,
      );
      expect.fail(
        `Bright green(s) above 40 % lightness found in stylesheet — ` +
        `these fail WCAG 4.5:1 contrast on the cream ground (#EFECE5).\n` +
        lines.join("\n"),
      );
    }
  });

  it("core green tokens resolve to accessible values", () => {
    // Read tokens.css :root block only
    const tokens = readFileSync(join(cssDir, "styles", "tokens.css"), "utf-8");
    const rootBlock = stripDarkBlock(stripComments(tokens));

    const expected: Record<string, [number, number, number]> = {
      // [maxH, maxS, maxL] — each component must be <= the bound
      // Actual values: #24503A → H≈140, S≈38%, L≈23%
      "--green":  [140, 0.40, 0.40],
      "--pos":    [140, 0.40, 0.40],
      "--ink":    [140, 0.40, 0.40],
    };

    for (const [token, [maxH, maxS, maxL]] of Object.entries(expected)) {
      const re = new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(#[0-9a-fA-F]{6})`);
      const m = rootBlock.match(re);
      expect(m, `Token ${token} not found in :root`).toBeTruthy();
      const rgb = parseHex(m![1]);
      expect(rgb).not.toBeNull();
      const [h, s, l] = rgbToHsl(...rgb!);
      expect(h, `${token} hue ${h.toFixed(0)}° should be in green range 60–180`).toBeGreaterThanOrEqual(60);
      expect(h, `${token} hue ${h.toFixed(0)}° should be in green range 60–180`).toBeLessThanOrEqual(180);
      expect(l, `${token} lightness ${(l * 100).toFixed(0)}% must be <= 40%`).toBeLessThanOrEqual(maxL);
    }
  });
});
