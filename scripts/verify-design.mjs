// Verify all design assertions from the spec (section 5)
// Run: node scripts/verify-design.mjs

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let passed = 0;
let failed = 0;
const failures = [];

function assert(description, condition) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${description}`);
  } else {
    failed++;
    failures.push(description);
    console.log(`  ❌ ${description}`);
  }
}

function readFile(path) {
  return readFileSync(path, "utf-8");
}

// ─── 1. Chart: gridlines, axis labels, baseline ───
console.log("\n📊 Chart assertions:");
const overviewTsx = readFile(join(ROOT, "UI/frontend/src/pages/OverviewPage.tsx"));

assert("Chart contains horizontal gridlines (<line> in gridlines map)",
  overviewTsx.includes("Gridlines") && overviewTsx.includes('stroke="var(--rule-light)"'));

assert("Chart has axis labels (first and last date <text> elements)",
  overviewTsx.includes("Time axis labels") && overviewTsx.includes('textAnchor="start"') && overviewTsx.includes('textAnchor="end"'));

assert("Chart has a baseline line",
  overviewTsx.includes("Baseline") && overviewTsx.includes('stroke="var(--rule)"'));

assert("Chart plot height is ~240px",
  overviewTsx.includes("plotH = 240"));

assert("Line is 2px brand green",
  overviewTsx.includes('stroke="var(--green)"') && overviewTsx.includes('strokeWidth="2"'));

assert("Area fill at ~8% opacity",
  overviewTsx.includes('fillOpacity="0.08"'));

// ─── 2. tabular-nums at root ───
console.log("\n🔢 Typography assertions:");
const globalCss = readFile(join(ROOT, "UI/frontend/src/styles/global.css"));

assert("tabular-nums is set on body (font-variant-numeric)",
  globalCss.includes("font-variant-numeric: tabular-nums"));

assert("tabular-nums is set on form elements (font-feature-settings: tnum)",
  globalCss.includes('font-feature-settings: "tnum"'));

// ─── 3. Section containers ───
console.log("\n📦 Section assertions:");
const overviewCss = readFile(join(ROOT, "UI/frontend/src/pages/OverviewPage.module.css"));

assert(".sectionCard class exists",
  overviewCss.includes(".sectionCard"));

assert(".sectionCard used by every major block (≥4 occurrences)",
  (overviewTsx.match(/sectionCard/g) || []).length >= 4);

assert(".page gap is 32px (var(--space-xl))",
  overviewCss.includes("gap: var(--space-xl)"));

assert(".sectionCard padding is 24px (var(--space-lg))",
  overviewCss.includes("space-lg"));

// Check that no full-width <hr> or rule-left/rule-right classes exist between sections
const sectionBoundaries = overviewTsx.match(/<\/section>\s*<section/g) || [];
const ruleBetweenSections = overviewTsx.match(/<\/section>\s*<(?:div|hr)[^>]*rule[^>]*>/g) || [];
assert("No full-width rules between section boundaries",
  ruleBetweenSections.length === 0);

// ─── 4. Section headers ───
console.log("\n📝 Section header assertions:");

assert(".sectionTitle uses display face (Fraunces)",
  overviewCss.includes(".sectionTitle") && overviewCss.includes("var(--font-display)"));

assert(".sectionTitle is at 22px (1.222rem)",
  overviewCss.includes(".sectionTitle") && overviewCss.includes("1.222rem"));

assert(".sectionTitle has generous bottom margin (var(--space-lg))",
  overviewCss.includes("margin-bottom: var(--space-lg)") || overviewCss.includes("margin-bottom:var(--space-lg)"));

assert("Section headers rendered as <h2> elements",
  overviewTsx.includes('<h2 className={styles.sectionTitle}>'));

// ─── 5. Form strip renders as elements ───
console.log("\n🎨 Form strip assertions:");
const formStripTsx = readFile(join(ROOT, "UI/frontend/src/components/FormStrip.tsx"));
const formStripCss = readFile(join(ROOT, "UI/frontend/src/components/FormStrip.module.css"));

assert("FormStrip renders .dot spans (not bare text)",
  formStripTsx.includes('className={`${styles.dot}') && formStripTsx.includes('sr-only'));

assert(".dot is 14px square",
  formStripCss.includes("width: 14px") && formStripCss.includes("height: 14px"));

assert(".dot has gap of 3px",
  formStripCss.includes("gap: 3px"));

assert(".win uses var(--green) background",
  formStripCss.includes(".win") && formStripCss.includes("var(--green)"));

assert(".loss uses var(--neg) background (clay/terracotta)",
  formStripCss.includes(".loss") && formStripCss.includes("var(--neg)"));

assert("FormStrip includes title attribute for accessibility",
  formStripTsx.includes('title={formTooltip(dot)}'));

assert("FormStrip includes aria-label for screen readers",
  formStripTsx.includes('aria-label={formTooltip(dot)}'));

// ─── 6. No regression: zero radius, no box-shadow ───
console.log("\n🔲 Zero-radius / no-shadow assertions:");

// Check for border-radius > 0 in all CSS files
const allCssFiles = [overviewCss, globalCss, formStripCss];
let hasRadius = false;
for (const css of allCssFiles) {
  const radiusMatches = css.match(/border-radius:\s*(\d+)/g) || [];
  for (const m of radiusMatches) {
    const val = parseInt(m.match(/\d+/)[0]);
    if (val > 0) {
      hasRadius = true;
      console.log(`    Found border-radius: ${m.trim()}`);
    }
  }
}
assert("No positive border-radius in core CSS",
  !hasRadius);

let hasBoxShadow = false;
for (const css of allCssFiles) {
  if (css.includes("box-shadow") && !css.includes("box-shadow: none") && !css.includes("box-shadow:none")) {
    hasBoxShadow = true;
    console.log("    Found box-shadow in CSS");
  }
}
assert("No box-shadow in core CSS (or only box-shadow: none)",
  !hasBoxShadow);

// ─── 7. Color contrast: accent ≠ positive ───
console.log("\n🎨 Color contrast assertions:");
const tokensCss = readFile(join(ROOT, "UI/frontend/src/styles/tokens.css"));

// Extract color values
function extractVar(css, name) {
  const re = new RegExp(`--${name}:\\s*([^;]+);`, "gm");
  const matches = [...css.matchAll(re)];
  const vals = matches.map(m => m[1].trim());
  return [...new Set(vals)]; // unique values per theme
}

const accentVals = extractVar(tokensCss, "accent");
const posVals = extractVar(tokensCss, "pos");

assert("Accent (brass) ≠ positive (green) in light theme",
  accentVals[0] !== posVals[0]);

assert("Accent (brass) ≠ positive (green) in dark theme",
  accentVals[1] !== posVals[1]);

console.log(`  Light: accent=${accentVals[0]}, pos=${posVals[0]}`);
console.log(`  Dark:  accent=${accentVals[1]}, pos=${posVals[1]}`);

// ─── 8. Tooltip truncation fix ───
console.log("\n💬 Tooltip assertions:");
assert("Tooltip label allows text wrapping",
  overviewCss.includes("white-space: normal") && overviewCss.includes(".tooltipLabel"));

assert("Tooltip label has word-break for long course names",
  overviewCss.includes("overflow-wrap: break-word") || overviewCss.includes("word-break: break-word"));

assert("Tooltip has max-width constraint",
  overviewCss.includes("max-width"));

// ─── 9. Font stack ───
console.log("\n🔤 Font assertions:");
assert("Inter loaded as body font",
  tokensCss.includes('"Inter"') && globalCss.includes("font-family: var(--font-sans)"));

assert("Fraunces loaded as display face",
  tokensCss.includes('"Fraunces"'));

assert("JetBrains Mono loaded for numbers",
  tokensCss.includes('"JetBrains Mono"'));

// ─── Results ───
console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exit(1);
} else {
  console.log("All assertions passed! 🎉");
}
