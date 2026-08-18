// Canonical famous / professional golfer data and helper to (re)seed them.
// Kept separate from seed.ts so admin endpoints can repair missing pros
// without dropping the rest of the database.

import crypto from "crypto";
import { hash } from "argon2";
import { seedRating, DEFAULTS } from "../../engine/index.js";
import type Database from "better-sqlite3";

const uid = () => crypto.randomUUID();

export interface FamousPlayer {
  name: string;
  club: string;
  region: string;
  basePlusHcp: number; // estimated peak/plus handicap (negative in WHS terms)
  majorWins: number;
  notes: string;
}

export const FAMOUS_PLAYERS: FamousPlayer[] = [
  { name: "Tiger Woods", club: "USA", region: "California", basePlusHcp: 8.0, majorWins: 15, notes: "Iconic clutch performer, peak dominance circa 2000" },
  { name: "Scottie Scheffler", club: "USA", region: "Texas", basePlusHcp: 7.5, majorWins: 2, notes: "Current world No. 1, elite ball-striking" },
  { name: "Rory McIlroy", club: "Northern Ireland", region: "Europe", basePlusHcp: 7.2, majorWins: 4, notes: "Four-time major champion, consistent top-5" },
  { name: "Jon Rahm", club: "Spain", region: "Europe", basePlusHcp: 7.0, majorWins: 2, notes: "Former world No. 1, powerful and consistent" },
  { name: "Brooks Koepka", club: "USA", region: "Florida", basePlusHcp: 6.8, majorWins: 5, notes: "Major specialist, peak major form" },
  { name: "Viktor Hovland", club: "Norway", region: "Europe", basePlusHcp: 6.6, majorWins: 0, notes: "Elite ball-striker, fast-improving short game" },
  { name: "Xander Schauffele", club: "USA", region: "California", basePlusHcp: 6.5, majorWins: 1, notes: "Olympic gold, major breakthrough" },
  { name: "Ludvig Åberg", club: "Sweden", region: "Europe", basePlusHcp: 6.3, majorWins: 0, notes: "Rising star, elite driver" },
  { name: "Collin Morikawa", club: "USA", region: "California", basePlusHcp: 6.2, majorWins: 2, notes: "Best iron player of his generation" },
  { name: "Bryson DeChambeau", club: "USA", region: "Texas", basePlusHcp: 6.0, majorWins: 2, notes: "Distance innovator, major winner" },
];

function summarizeIntoSeed(p: FamousPlayer): number {
  const majorBump = Math.min(p.majorWins * 0.15, 0.6);
  const prestigeHash = p.name.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const prestigeBump = (prestigeHash % 5) / 10;
  const plusHcp = p.basePlusHcp + majorBump + prestigeBump;
  return seedRating(-plusHcp, DEFAULTS);
}

export function famousEmail(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, ".") + "@famous.golf";
}

export async function ensureFamousPlayers(db: Database.Database, adminId?: string | null) {
  const famousHash = await hash("major123");
  const famousIds: Record<string, string> = {};
  let inserted = 0;

  for (const f of FAMOUS_PLAYERS) {
    const email = famousEmail(f.name);
    const existing = db.prepare("SELECT id, is_pro FROM users WHERE email = ?").get(email) as
      | { id: string; is_pro: number }
      | undefined;

    if (existing) {
      famousIds[f.name] = existing.id;
      if (existing.is_pro === 0) {
        db.prepare("UPDATE users SET is_pro = 1, is_public = 1, updated_at = datetime('now') WHERE id = ?")
          .run(existing.id);
      }
      continue;
    }

    const id = uid();
    famousIds[f.name] = id;
    const whsHcp = -(f.basePlusHcp + Math.min(f.majorWins * 0.15, 0.6));
    db.prepare(`INSERT INTO users (id, email, password_hash, display_name, home_club, region, sga_handicap, is_public, is_pro)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(id, email, famousHash, f.name, f.club, f.region, whsHcp, 1);
    console.log(`Seeded ${f.name}: AI summary → seed rating ${Math.round(summarizeIntoSeed(f))} (${f.notes})`);
    inserted++;
  }

  // Build mutual friendship links between all famous players.
  const famousNames = Object.keys(famousIds);
  for (let i = 0; i < famousNames.length; i++) {
    for (let j = i + 1; j < famousNames.length; j++) {
      const a = famousIds[famousNames[i]];
      const b = famousIds[famousNames[j]];
      const exists = db.prepare(
        "SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?"
      ).get(a, b);
      if (!exists) {
        db.prepare("INSERT INTO friendships (id, user_id, friend_id) VALUES (?, ?, ?)").run(uid(), a, b);
        db.prepare("INSERT INTO friendships (id, user_id, friend_id) VALUES (?, ?, ?)").run(uid(), b, a);
      }
    }
  }

  // If any famous players were just inserted, generate rounds so they show up in rankings.
  if (inserted > 0 && adminId) {
    await seedFamousRounds(db, famousIds, adminId);
  }

  return { inserted, famousIds };
}

async function seedFamousRounds(
  db: Database.Database,
  famousIds: Record<string, string>,
  adminId: string
) {
  const famousNames = Object.keys(famousIds);
  if (famousNames.length === 0) return;

  // Use the same representative course constants the full seed uses. Course
  // CR/Slope live on the tees table, not the courses table.
  const courseRows = [
    { name: "Sentosa (Serapong)", cr: 72.0, slope: 130 },
    { name: "Tanah Merah (Tampines)", cr: 71.4, slope: 125 },
    { name: "Laguna National (Classic)", cr: 73.1, slope: 138 },
  ];

  const famousScoreBase: Record<string, number> = {
    "Tiger Woods": 68, "Scottie Scheffler": 68, "Rory McIlroy": 69,
    "Jon Rahm": 69, "Brooks Koepka": 69, "Viktor Hovland": 69,
    "Xander Schauffele": 69, "Ludvig Åberg": 69, "Collin Morikawa": 69,
    "Bryson DeChambeau": 70,
  };

  const rounds: Array<{ d: string; f: "stroke" | "match"; c: { name: string; cr: number; slope: number }; p: [string, number][] }> = [];

  // 24 stroke-play rounds among famous players (3–4 players each).
  for (let i = 0; i < 24; i++) {
    const date = new Date(2026, 3, 5 + i * 4); // Apr–Oct 2026
    const course = courseRows[i % courseRows.length];
    const shuffled = [...famousNames].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 3 + (i % 2));
    const p: [string, number][] = selected.map((name) => {
      const base = famousScoreBase[name];
      const variance = Math.round((Math.random() - 0.5) * 5);
      return [name, Math.max(base + variance, 64)];
    });
    rounds.push({ d: date.toISOString().slice(0, 10), f: "stroke", c: course, p });
  }

  // 6 match-play rounds for variety.
  for (let i = 0; i < 6; i++) {
    const date = new Date(2026, 4, 10 + i * 12);
    const course = courseRows[i % courseRows.length];
    const shuffled = [...famousNames].sort(() => Math.random() - 0.5);
    const [a, b] = shuffled.slice(0, 2);
    const [aw, bw] = Math.random() > 0.5 ? [7, 4] : [6, 5];
    rounds.push({ d: date.toISOString().slice(0, 10), f: "match", c: course, p: [[a, aw], [b, bw]] });
  }

  for (const r of rounds) {
    const roundId = uid();
    db.prepare(`INSERT INTO rounds (id, logged_by, date, format, course, status)
      VALUES (?, ?, ?, ?, ?, 'confirmed')`).run(roundId, adminId, r.d, r.f, r.c.name);
    for (const [name, score] of r.p) {
      const pid = famousIds[name];
      if (!pid) continue;
      if (r.f === "match") {
        db.prepare(`INSERT INTO round_participants (id, round_id, player_id, holes_won, cr, slope)
          VALUES (?, ?, ?, ?, ?, ?)`).run(uid(), roundId, pid, score, r.c.cr, r.c.slope);
      } else {
        db.prepare(`INSERT INTO round_participants (id, round_id, player_id, ags, cr, slope)
          VALUES (?, ?, ?, ?, ?, ?)`).run(uid(), roundId, pid, score, r.c.cr, r.c.slope);
      }
    }
  }

  console.log(`Seeded ${rounds.length} rounds for ${famousNames.length} famous players`);
}
