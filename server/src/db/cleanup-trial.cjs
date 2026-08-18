#!/usr/bin/env node
/**
 * Trial cleanup — removes demo/test accounts and all rounds tied to them.
 *
 * KEEPS:
 *   - admin@test.golf            (the admin account)
 *   - michaelz.zhanghan@gmail.com (mike — the owner/coach)
 *   - rcyc@gmail.com             (son — real account)
 *   - all @famous.golf pro players (is_pro=1, fully isolated: 0 rounds/friendships)
 *   - all 18 Shanghai courses + tees
 *
 * REMOVES:
 *   - 18 Singapore demo users (fake students seeded via the API earlier)
 *   - testapi@form.golf, withconsent@test.golf (test accounts)
 *   - every round (confirmed or pending) that references a removed user
 *   - attestations, ai_analysis, friendships, friend_requests, sessions,
 *     play_invitations, password_resets tied to removed users / removed rounds
 *
 * Safe to run while the server is up (SQLite WAL, wrapped in a transaction).
 */
const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "..", "data", "form.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── 1. Identify the accounts to remove ────────────────────────────────────────
const DEMO_EMAILS = [
  "john.chen@outlook.com",
  "david.lim@yahoo.com",
  "marcus.tan@gmail.com",
  "ryan.ngs@gmail.com",
  "adrian.koh@outlook.sg",
  "kelvin.wongg@yahoo.sg",
  "bryan.lee88@gmail.com",
  "desmond.chua@outlook.sg",
  "eugene.tan@yahoo.sg",
  "francis.lim@gmail.com",
  "gary.teo@hotmail.com",
  "henry.ong@outlook.sg",
  "ian.kohh@gmail.com",
  "jason.yeo@yahoo.sg",
  "keith.soh@outlook.com",
  "leonard.ng@gmail.com",
  "nigel.chang@hotmail.sg",
  "peter.goh@gmail.com",
  "testapi@form.golf",
  "withconsent@test.golf",
];

const placeholders = DEMO_EMAILS.map(() => "?").join(",");
const targets = db
  .prepare(`SELECT id, email FROM users WHERE email IN (${placeholders})`)
  .all(...DEMO_EMAILS);

if (targets.length === 0) {
  console.log("No target accounts found — nothing to do.");
  process.exit(0);
}
const targetIds = targets.map((t) => t.id);
const idPlaceholders = targetIds.map(() => "?").join(",");
console.log(`Removing ${targets.length} accounts:`);
for (const t of targets) console.log(`  - ${t.email}`);

// ── 2. Cascade delete inside one transaction ──────────────────────────────────
const cleanup = db.transaction(() => {
  // rounds owned by or referencing a removed user
  const roundIds = db
    .prepare(
      `SELECT DISTINCT r.id FROM rounds r
       LEFT JOIN round_participants rp ON rp.round_id = r.id
       WHERE r.logged_by IN (${idPlaceholders})
          OR rp.player_id IN (${idPlaceholders})`
    )
    .all(...targetIds, ...targetIds)
    .map((r) => r.id);
  const roundPlaceholders = roundIds.map(() => "?").join(",");

  let count = 0;
  if (roundIds.length > 0) {
    const q = (sql) => db.prepare(sql).run(...roundIds).changes;

    count += q(`DELETE FROM round_participants WHERE round_id IN (${roundPlaceholders})`);
    count += q(`DELETE FROM attestations WHERE round_id IN (${roundPlaceholders})`);
    count += q(`DELETE FROM ai_analysis WHERE round_id IN (${roundPlaceholders})`);
    count += q(`DELETE FROM rounds WHERE id IN (${roundPlaceholders})`);
    console.log(`Removed ${roundIds.length} rounds (+ participants/attestations/ai).`);
  }

  // rows referencing removed users directly
  count += db.prepare(`DELETE FROM round_participants WHERE player_id IN (${idPlaceholders})`).run(...targetIds).changes;
  count += db.prepare(`DELETE FROM attestations WHERE from_id IN (${idPlaceholders}) OR to_id IN (${idPlaceholders})`).run(...targetIds, ...targetIds).changes;
  count += db.prepare(`DELETE FROM friendships WHERE user_id IN (${idPlaceholders}) OR friend_id IN (${idPlaceholders})`).run(...targetIds, ...targetIds).changes;
  count += db.prepare(`DELETE FROM friend_requests WHERE from_id IN (${idPlaceholders}) OR to_id IN (${idPlaceholders})`).run(...targetIds, ...targetIds).changes;
  count += db.prepare(`DELETE FROM sessions WHERE user_id IN (${idPlaceholders})`).run(...targetIds).changes;
  count += db.prepare(`DELETE FROM play_invitations WHERE from_id IN (${idPlaceholders}) OR to_id IN (${idPlaceholders})`).run(...targetIds, ...targetIds).changes;
  count += db.prepare(`DELETE FROM password_resets WHERE user_id IN (${idPlaceholders})`).run(...targetIds).changes;

  // drop the users themselves
  const usersRemoved = db.prepare(`DELETE FROM users WHERE id IN (${idPlaceholders})`).run(...targetIds).changes;

  // all password_resets rows are test artifacts — clear them all
  count += db.prepare("DELETE FROM password_resets").run().changes;

  return { roundIds: roundIds.length, usersRemoved, otherRows: count };
});

try {
  const result = cleanup();
  console.log(
    `Done. Users removed: ${result.usersRemoved} | Rounds removed: ${result.roundIds} | Related rows touched: ${result.otherRows}`
  );

  // ── 3. Summary of what remains ──────────────────────────────────────────────
  const users = db.prepare("SELECT COUNT(*) c FROM users").get().c;
  const pros = db.prepare("SELECT COUNT(*) c FROM users WHERE is_pro=1").get().c;
  const rounds = db.prepare("SELECT COUNT(*) c FROM rounds").get().c;
  const courses = db.prepare("SELECT COUNT(*) c FROM courses").get().c;
  const friends = db.prepare("SELECT COUNT(*) c FROM friendships").get().c;
  console.log(
    `Remaining → users: ${users} (${pros} pros) | rounds: ${rounds} | courses: ${courses} | friendships: ${friends}`
  );
} catch (err) {
  console.error("Cleanup failed, transaction rolled back:", err.message);
  process.exit(1);
} finally {
  db.close();
}
