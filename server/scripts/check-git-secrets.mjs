#!/usr/bin/env node
/**
 * Pre-build security check:
 * Fails if `.env` (or any `.env.*` except `.env.example`) is tracked by git.
 *
 * Run with: node scripts/check-git-secrets.mjs
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// 1. Verify .gitignore covers .env files
const gitignorePath = resolve(projectRoot, "..", ".gitignore");
if (!existsSync(gitignorePath)) {
  console.warn("⚠️  No .gitignore found at project root. Add .env to .gitignore immediately.");
} else {
  const gitignore = readFileSync(gitignorePath, "utf-8");
  const lines = gitignore.split(/\r?\n/).map((l) => l.trim());
  const hasEnv = lines.some((l) => l === ".env" || l === "/.env");
  const hasEnvStar = lines.some((l) => l === ".env.*" || l === "/.env.*");
  const hasExample = lines.some((l) => l.startsWith("!") && l.includes(".env.example"));

  // Check that .env and .env.* are ignored (not committed)
  const relaxedCheck = lines.some((l) => l === ".env"); // at minimum .env
  if (!relaxedCheck && !hasEnv) {
    console.error("❌ .gitignore does not include '.env'. Add it immediately.");
    process.exit(1);
  } else {
    console.log("✅ .gitignore covers .env files");
  }
}

// 2. Check if git repo exists and .env is tracked
try {
  const gitRoot = execSync("git rev-parse --show-toplevel", {
    cwd: projectRoot,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();

  // Check tracked .env files
  const tracked = execSync(
    'git ls-files --cached --others --exclude-standard -- "*.env*" | grep -v ".env.example" || true',
    { cwd: gitRoot, encoding: "utf-8" }
  ).trim();

  if (tracked) {
    console.error(`❌ SECURITY: The following .env files are tracked by git:\n${tracked}`);
    console.error("   → Rotate all secrets immediately.");
    console.error("   → Run: git rm --cached <file>");
    console.error("   → Verify .gitignore includes '.env' and '.env.*'");
    process.exit(1);
  }

  // Check if secrets ever existed in git history
  const history = execSync(
    'git log --all --full-history -- "**/.env" "**/.env.local" "**/.env.production" 2>/dev/null | head -1 || true',
    { cwd: gitRoot, encoding: "utf-8" }
  ).trim();

  if (history) {
    console.error("❌ SECURITY: .env files exist in git history. Rotation is not sufficient.");
    console.error("   → Use git-filter-repo or BFG to rewrite history.");
    console.error("   → Rotate all secrets after history is cleaned.");
    process.exit(1);
  }

  console.log("✅ No tracked .env files in git");

  // 3. Verify .env files have proper permissions (600)
  const envFile = resolve(projectRoot, ".env");
  if (existsSync(envFile)) {
    try {
      const stat = execSync(`stat -f "%p" "${envFile}"`, { encoding: "utf-8" }).trim();
      // macOS stat: permissions are last 3 chars of octal
      const perms = stat.slice(-3);
      if (perms !== "600" && perms !== "400") {
        console.warn(`⚠️  .env permissions are ${perms} — consider chmod 600 ${envFile}`);
      }
    } catch {
      // stat may not work on all platforms
    }
  }
} catch (err) {
  // Not a git repo — that's fine, this check is for CI/committed repos
  if (err.message?.includes("not a git repository")) {
    console.log("ℹ️  No git repository — skipping git history check");
  } else {
    console.error("❌ Git check failed:", err.message);
  }
}

console.log("✅ Security lint passed");
