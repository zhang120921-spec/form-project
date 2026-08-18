// Seed script: admin account, default courses, and world-famous pro players.
// No demo users, fake friendships, or synthetic rounds are created. Real player
// lists and ratings come entirely from user-input rounds processed by the engine.
import db from "./connection.js";
import { runMigrations } from "./schema.js";
import crypto from "crypto";
import { hash } from "argon2";
import { ensureFamousPlayers } from "./pros.js";

const uid = () => crypto.randomUUID();

export async function seed() {
  runMigrations();

  console.log("Seeding database...");

  // Admin account
  const adminHash = await hash("admin123");
  const adminId = uid();
  db.prepare(`INSERT INTO users (id, email, password_hash, display_name, is_admin)
    VALUES (?, ?, ?, ?, 1)`).run(adminId, "admin@form.golf", adminHash, "Admin");

  // ═════ World-famous players (Compare to Pros feature) ═════
  await ensureFamousPlayers(db, adminId);

  // ═════ Default courses ═════
  // These are course definitions, not player data. Users log their real rounds
  // against these; ratings are still computed from actual scores.
  const courses = [
    { name: "Sentosa (Serapong)", club: "Sentosa GC", verified: true, source: "SGA", tees: [
      { name: "White", colour: "White", yardage: 6299, par: 72, cr: 72.0, slope: 130, cr9: 36.0, slope9: 130 }
    ]},
    { name: "Sentosa (New Tanjong)", club: "Sentosa GC", verified: false, source: "Club", tees: [
      { name: "White", colour: "White", yardage: 6200, par: 72, cr: 71.2, slope: 128, cr9: 35.6, slope9: 128 }
    ]},
    { name: "Tanah Merah (Tampines)", club: "Tanah Merah CC", verified: true, source: "Club", tees: [
      { name: "White", colour: "White", yardage: 6148, par: 72, cr: 71.4, slope: 125, cr9: 35.7, slope9: 125 }
    ]},
    { name: "Tanah Merah (Garden)", club: "Tanah Merah CC", verified: false, source: "Club", tees: [
      { name: "White", colour: "White", yardage: 6300, par: 72, cr: 71.8, slope: 127, cr9: 35.9, slope9: 127 }
    ]},
    { name: "Laguna National (Classic)", club: "Laguna National", verified: true, source: "Club", tees: [
      { name: "White", colour: "White", yardage: 6407, par: 72, cr: 73.1, slope: 138, cr9: 36.6, slope9: 138 }
    ]},
    { name: "Laguna National (Masters)", club: "Laguna National", verified: false, source: "Club", tees: [
      { name: "White", colour: "White", yardage: 6350, par: 72, cr: 72.4, slope: 132, cr9: 36.2, slope9: 132 }
    ]},
    { name: "Singapore Island CC", club: "SICC", verified: false, source: "Club", tees: [
      { name: "White", colour: "White", yardage: 6320, par: 72, cr: 72.5, slope: 131, cr9: 36.3, slope9: 131 }
    ]},
    { name: "Keppel Club", club: "Keppel Club", verified: false, source: "Club", tees: [
      { name: "White", colour: "White", yardage: 6000, par: 71, cr: 70.8, slope: 124, cr9: 35.4, slope9: 124 }
    ]},
    { name: "Marina Bay Golf Course", club: "Marina Bay", verified: false, source: "Club", tees: [
      { name: "White", colour: "White", yardage: 6493, par: 72, cr: 72.1, slope: 133, cr9: 36.1, slope9: 133 }
    ]},
  ];

  for (const c of courses) {
    const courseId = uid();
    db.prepare("INSERT INTO courses (id, name, club, verified, source) VALUES (?, ?, ?, ?, ?)")
      .run(courseId, c.name, c.club, c.verified ? 1 : 0, c.source || null);
    for (const t of c.tees) {
      const frontCr = t.cr / 2;
      const frontSlope = t.slope;
      const backCr = t.cr / 2;
      const backSlope = t.slope;
      db.prepare(`INSERT INTO tees (id, course_id, name, colour, yardage, par, cr, slope, cr9, slope9, front_cr, front_slope, back_cr, back_slope)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uid(), courseId, t.name, t.colour, t.yardage, t.par, t.cr, t.slope,
          t.cr9 || null, t.slope9 || null, frontCr, frontSlope, backCr, backSlope);
    }
  }

  console.log("Seeded: admin, famous pros, 9 courses. No demo players or synthetic rounds.");
  console.log("── Credentials ──");
  console.log("Admin: admin@form.golf / admin123");
}

// Run directly when executed as a script, not when imported
if (process.argv[1]?.includes("seed")) {
  seed().catch(console.error);
}
