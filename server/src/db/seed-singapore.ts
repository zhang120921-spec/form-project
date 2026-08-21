// Add Singapore golf courses alongside whatever's already in the courses
// table (Shanghai, etc.) — this is additive, unlike seed-shanghai.ts which
// replaces the whole list. Safe to re-run: skips any course whose name
// already exists.
//
// CR/Slope figures supplied directly by the team running the trial (real
// published tee-box data). Par is a standard-course estimate where not
// given, so these are marked "verified: false" (UI shows "ESTIMATED") —
// same convention as the rest of the unverified catalog.
//
// Run: npx tsx src/db/seed-singapore.ts   (safe to run while the server is up — WAL mode)

import db from "./connection.js";
import crypto from "crypto";

const uid = () => crypto.randomUUID();

interface Tee {
  name: string;
  colour: string;
  par: number;
  cr: number;
  slope: number;
}

interface Course {
  name: string;
  club: string;
  verified: boolean;
  source: string;
  tees: Tee[];
}

const courses: Course[] = [
  {
    name: "Sentosa (Serapong)",
    club: "Sentosa Golf Club",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", par: 71, cr: 76.4, slope: 155 },
      { name: "Blue", colour: "Blue", par: 71, cr: 73.8, slope: 141 },
      { name: "White", colour: "White", par: 71, cr: 71.3, slope: 135 },
      { name: "Red", colour: "Red", par: 71, cr: 74.5, slope: 136 },
    ],
  },
  {
    name: "Sentosa (New Tanjong)",
    club: "Sentosa Golf Club",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", par: 71, cr: 74.2, slope: 141 },
      { name: "Blue", colour: "Blue", par: 71, cr: 72.2, slope: 138 },
      { name: "White", colour: "White", par: 71, cr: 70.1, slope: 133 },
      { name: "Red", colour: "Red", par: 71, cr: 72.5, slope: 131 },
    ],
  },
  {
    name: "Laguna National (Classic)",
    club: "Laguna National Golf Resort Club",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", par: 72, cr: 76.4, slope: 162 },
      { name: "Blue", colour: "Blue", par: 72, cr: 74.1, slope: 152 },
      { name: "White", colour: "White", par: 72, cr: 71.8, slope: 142 },
      { name: "Red", colour: "Red", par: 72, cr: 73.5, slope: 138 },
    ],
  },
  {
    name: "Laguna National (Masters)",
    club: "Laguna National Golf Resort Club",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", par: 72, cr: 74.0, slope: 144 },
      { name: "Blue", colour: "Blue", par: 72, cr: 71.5, slope: 138 },
      { name: "White", colour: "White", par: 72, cr: 69.2, slope: 132 },
      { name: "Red", colour: "Red", par: 72, cr: 71.8, slope: 128 },
    ],
  },
  {
    name: "Tanah Merah (Tampines)",
    club: "Tanah Merah Country Club",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", par: 72, cr: 75.1, slope: 133 },
      { name: "Blue", colour: "Blue", par: 72, cr: 72.6, slope: 128 },
      { name: "White", colour: "White", par: 72, cr: 70.2, slope: 122 },
      { name: "Red", colour: "Red", par: 72, cr: 74.2, slope: 129 },
    ],
  },
  {
    name: "Tanah Merah (Garden)",
    club: "Tanah Merah Country Club",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", par: 71, cr: 70.1, slope: 123 },
      { name: "Blue", colour: "Blue", par: 71, cr: 68.4, slope: 119 },
      { name: "White", colour: "White", par: 71, cr: 67.2, slope: 117 },
      { name: "Red", colour: "Red", par: 71, cr: 72.7, slope: 131 },
    ],
  },
  {
    name: "Singapore Island CC (Bukit)",
    club: "Singapore Island Country Club",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", par: 72, cr: 72.3, slope: 129 },
      { name: "Blue", colour: "Blue", par: 72, cr: 71.4, slope: 128 },
      { name: "White", colour: "White", par: 72, cr: 69.6, slope: 124 },
      { name: "Red", colour: "Red", par: 72, cr: 74.5, slope: 134 },
    ],
  },
  {
    name: "Singapore Island CC (Island)",
    club: "Singapore Island Country Club",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", par: 72, cr: 72.5, slope: 130 },
      { name: "Blue", colour: "Blue", par: 72, cr: 70.9, slope: 129 },
      { name: "White", colour: "White", par: 72, cr: 70.0, slope: 125 },
      { name: "Red", colour: "Red", par: 72, cr: 73.1, slope: 128 },
    ],
  },
  {
    name: "Seletar Country Club",
    club: "Seletar Country Club",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", par: 72, cr: 75.5, slope: 147 },
      { name: "Blue", colour: "Blue", par: 72, cr: 73.7, slope: 143 },
      { name: "White", colour: "White", par: 72, cr: 71.2, slope: 141 },
      { name: "Gold", colour: "Gold", par: 72, cr: 67.1, slope: 129 },
      { name: "Red", colour: "Red", par: 72, cr: 73.4, slope: 140 },
    ],
  },
  {
    name: "Sembawang Country Club",
    club: "Sembawang Country Club",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", par: 72, cr: 72.4, slope: 138 },
      { name: "Blue", colour: "Blue", par: 72, cr: 70.5, slope: 132 },
      { name: "White", colour: "White", par: 72, cr: 67.8, slope: 126 },
      { name: "Red", colour: "Red", par: 72, cr: 67.1, slope: 123 },
    ],
  },
  {
    name: "Warren Golf & Country Club",
    club: "Warren Golf & Country Club",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", par: 72, cr: 72.1, slope: 131 },
      { name: "Blue", colour: "Blue", par: 72, cr: 70.6, slope: 127 },
      { name: "White", colour: "White", par: 72, cr: 68.9, slope: 122 },
      { name: "Red", colour: "Red", par: 72, cr: 71.4, slope: 125 },
    ],
  },
  {
    name: "Orchid Country Club",
    club: "Orchid Country Club (Aranda / Dendro / Vanda)",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Blue", colour: "Blue", par: 72, cr: 71.8, slope: 126 },
      { name: "White", colour: "White", par: 72, cr: 69.5, slope: 121 },
      { name: "Red", colour: "Red", par: 72, cr: 72.1, slope: 124 },
    ],
  },
  {
    name: "Keppel Club (Sime)",
    club: "Keppel Club",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Blue", colour: "Blue", par: 72, cr: 71.2, slope: 126 },
      { name: "White", colour: "White", par: 72, cr: 69.1, slope: 121 },
      { name: "Red", colour: "Red", par: 72, cr: 71.8, slope: 123 },
    ],
  },
  {
    name: "NSRCC (Changi)",
    club: "National Service Resort & Country Club",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Blue", colour: "Blue", par: 72, cr: 71.5, slope: 128 },
      { name: "White", colour: "White", par: 72, cr: 69.2, slope: 123 },
      { name: "Red", colour: "Red", par: 72, cr: 71.0, slope: 121 },
    ],
  },
  {
    name: "Changi Golf Club (9-Hole)",
    club: "Changi Golf Club",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Blue", colour: "Blue", par: 35, cr: 67.8, slope: 118 },
      { name: "White", colour: "White", par: 35, cr: 66.2, slope: 115 },
      { name: "Red", colour: "Red", par: 35, cr: 68.5, slope: 116 },
    ],
  },
];

// ═══════════════ Run ═══════════════

const tx = db.transaction(() => {
  let inserted = 0;
  let skipped = 0;

  for (const c of courses) {
    const existing = db.prepare("SELECT id FROM courses WHERE name = ?").get(c.name);
    if (existing) {
      skipped++;
      continue;
    }

    const courseId = uid();
    db.prepare("INSERT INTO courses (id, name, club, verified, source) VALUES (?, ?, ?, ?, ?)")
      .run(courseId, c.name, c.club, c.verified ? 1 : 0, c.source);
    for (const t of c.tees) {
      const frontCr = Math.round((t.cr / 2) * 10) / 10;
      db.prepare(`INSERT INTO tees (id, course_id, name, colour, par, cr, slope, cr9, slope9, front_cr, front_slope, back_cr, back_slope)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uid(), courseId, t.name, t.colour, t.par, t.cr, t.slope,
          frontCr, t.slope, frontCr, t.slope, frontCr, t.slope);
    }
    inserted++;
  }

  return { inserted, skipped };
});

try {
  const { inserted, skipped } = tx();
  const total = db.prepare("SELECT COUNT(*) AS c FROM courses").get() as { c: number };
  console.log(`Added ${inserted} Singapore courses (${skipped} already present). ${total.c} courses total in catalog now.`);
} catch (err) {
  console.error("Seed failed:", err);
  process.exit(1);
}
