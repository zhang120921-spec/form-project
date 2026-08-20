// Seed all major Shanghai golf courses for the Shanghai trial.
// Replaces the existing (Singapore) course list — rounds store course names as
// plain text, so history is unaffected. Verified courses carry real published
// rating/slope data; the rest are marked unverified (UI shows "ESTIMATED") with
// ratings estimated from published yardage.
//
// Run: npx tsx src/db/seed-shanghai.ts   (safe to run while the server is up — WAL mode)

import db from "./connection.js";
import crypto from "crypto";

const uid = () => crypto.randomUUID();

interface Tee {
  name: string;
  colour: string;
  yardage: number;
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
  // ── Verified with real published data ──
  {
    name: "Sheshan International (佘山国际)",
    club: "上海佘山国际高尔夫俱乐部",
    verified: true,
    source: "Club",
    tees: [
      { name: "Black", colour: "Black", yardage: 7288, par: 72, cr: 75.2, slope: 138 },
      { name: "Blue", colour: "Blue", yardage: 6779, par: 72, cr: 73.3, slope: 133 },
      { name: "White", colour: "White", yardage: 6274, par: 72, cr: 71.2, slope: 128 },
      { name: "Red", colour: "Red", yardage: 5530, par: 72, cr: 68.5, slope: 122 },
    ],
  },
  {
    name: "Shanghai Links (林克司)",
    club: "上海林克司高尔夫乡村俱乐部",
    verified: true,
    source: "GolfLux",
    tees: [
      { name: "Black", colour: "Black", yardage: 7121, par: 72, cr: 74.9, slope: 131 },
      { name: "Gold", colour: "Gold", yardage: 6783, par: 72, cr: 73.6, slope: 129 },
      { name: "Blue", colour: "Blue", yardage: 6440, par: 72, cr: 72.1, slope: 126 },
      { name: "White", colour: "White", yardage: 5777, par: 72, cr: 69.0, slope: 121 },
      { name: "Red", colour: "Red", yardage: 5117, par: 72, cr: 69.1, slope: 114 },
    ],
  },
  {
    name: "Yintao (银涛)",
    club: "上海银涛高尔夫俱乐部",
    verified: true,
    source: "GolfLux",
    tees: [
      { name: "Black", colour: "Black", yardage: 7129, par: 72, cr: 74.9, slope: 131 },
      { name: "Blue", colour: "Blue", yardage: 6654, par: 72, cr: 73.1, slope: 123 },
      { name: "White", colour: "White", yardage: 6389, par: 72, cr: 70.7, slope: 121 },
      { name: "Red", colour: "Red", yardage: 5898, par: 72, cr: 69.2, slope: 117 },
    ],
  },
  {
    name: "Sun Island (太阳岛)",
    club: "上海太阳岛国际俱乐部",
    verified: true,
    source: "Club",
    tees: [
      { name: "Black", colour: "Black", yardage: 6861, par: 72, cr: 73.5, slope: 130 },
      { name: "Blue", colour: "Blue", yardage: 6444, par: 72, cr: 72.2, slope: 126 },
      { name: "White", colour: "White", yardage: 6108, par: 72, cr: 70.9, slope: 123 },
      { name: "Red", colour: "Red", yardage: 5481, par: 72, cr: 68.6, slope: 117 },
    ],
  },
  // ── Estimated (unverified → UI shows ESTIMATED badge) ──
  {
    name: "Qizhong (旗忠)",
    club: "上海旗忠高尔夫俱乐部",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", yardage: 7129, par: 72, cr: 74.8, slope: 131 },
      { name: "Blue", colour: "Blue", yardage: 6700, par: 72, cr: 73.0, slope: 128 },
      { name: "White", colour: "White", yardage: 6200, par: 72, cr: 71.0, slope: 124 },
      { name: "Red", colour: "Red", yardage: 5500, par: 72, cr: 68.4, slope: 118 },
    ],
  },
  {
    name: "Tomson Pudong (汤臣)",
    club: "汤臣上海浦东高尔夫球场",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", yardage: 7200, par: 72, cr: 74.9, slope: 132 },
      { name: "Blue", colour: "Blue", yardage: 6750, par: 72, cr: 73.2, slope: 129 },
      { name: "White", colour: "White", yardage: 6250, par: 72, cr: 71.1, slope: 125 },
      { name: "Red", colour: "Red", yardage: 5550, par: 72, cr: 68.6, slope: 119 },
    ],
  },
  {
    name: "Lake Malaren Masters (美兰湖·名人赛)",
    club: "上海美兰湖高尔夫俱乐部",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", yardage: 7200, par: 72, cr: 74.9, slope: 133 },
      { name: "Blue", colour: "Blue", yardage: 6750, par: 72, cr: 73.2, slope: 129 },
      { name: "White", colour: "White", yardage: 6250, par: 72, cr: 71.1, slope: 125 },
      { name: "Red", colour: "Red", yardage: 5530, par: 72, cr: 68.5, slope: 119 },
    ],
  },
  {
    name: "Lake Malaren Golden Bear (美兰湖·金熊)",
    club: "上海美兰湖高尔夫俱乐部",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", yardage: 7100, par: 72, cr: 74.5, slope: 132 },
      { name: "Blue", colour: "Blue", yardage: 6650, par: 72, cr: 72.9, slope: 128 },
      { name: "White", colour: "White", yardage: 6150, par: 72, cr: 70.8, slope: 123 },
      { name: "Red", colour: "Red", yardage: 5450, par: 72, cr: 68.3, slope: 117 },
    ],
  },
  {
    name: "Yingyi Anting (颖奕安亭)",
    club: "上海颖奕安亭高尔夫俱乐部",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", yardage: 7200, par: 72, cr: 74.8, slope: 132 },
      { name: "Blue", colour: "Blue", yardage: 6730, par: 72, cr: 73.1, slope: 128 },
      { name: "White", colour: "White", yardage: 6230, par: 72, cr: 71.0, slope: 124 },
      { name: "Red", colour: "Red", yardage: 5520, par: 72, cr: 68.5, slope: 118 },
    ],
  },
  {
    name: "Palm Beach (棕榈滩)",
    club: "上海棕榈滩海景高尔夫俱乐部",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", yardage: 7288, par: 72, cr: 75.0, slope: 133 },
      { name: "Blue", colour: "Blue", yardage: 6800, par: 72, cr: 73.4, slope: 130 },
      { name: "White", colour: "White", yardage: 6300, par: 72, cr: 71.2, slope: 125 },
      { name: "Red", colour: "Red", yardage: 5600, par: 72, cr: 68.8, slope: 119 },
    ],
  },
  {
    name: "Tianma (天马)",
    club: "上海天马乡村俱乐部",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", yardage: 7030, par: 72, cr: 74.2, slope: 131 },
      { name: "Blue", colour: "Blue", yardage: 6600, par: 72, cr: 72.7, slope: 128 },
      { name: "White", colour: "White", yardage: 6100, par: 72, cr: 70.7, slope: 123 },
      { name: "Red", colour: "Red", yardage: 5430, par: 72, cr: 68.2, slope: 117 },
    ],
  },
  {
    name: "Shanghai International (上海国际)",
    club: "上海国际高尔夫球乡村俱乐部",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", yardage: 7010, par: 72, cr: 74.1, slope: 131 },
      { name: "Blue", colour: "Blue", yardage: 6580, par: 72, cr: 72.6, slope: 127 },
      { name: "White", colour: "White", yardage: 6090, par: 72, cr: 70.7, slope: 123 },
      { name: "Red", colour: "Red", yardage: 5420, par: 72, cr: 68.2, slope: 116 },
    ],
  },
  {
    name: "PGA Anying (PGA 安瀛)",
    club: "PGA安瀛高尔夫俱乐部",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", yardage: 7100, par: 72, cr: 74.6, slope: 132 },
      { name: "Blue", colour: "Blue", yardage: 6670, par: 72, cr: 73.0, slope: 128 },
      { name: "White", colour: "White", yardage: 6180, par: 72, cr: 70.9, slope: 124 },
      { name: "Red", colour: "Red", yardage: 5500, par: 72, cr: 68.4, slope: 118 },
    ],
  },
  {
    name: "Huakai (华凯)",
    club: "上海华凯乡村体育俱乐部",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", yardage: 6900, par: 72, cr: 73.9, slope: 130 },
      { name: "Blue", colour: "Blue", yardage: 6480, par: 72, cr: 72.2, slope: 127 },
      { name: "White", colour: "White", yardage: 6030, par: 72, cr: 70.5, slope: 122 },
      { name: "Red", colour: "Red", yardage: 5380, par: 72, cr: 68.0, slope: 116 },
    ],
  },
  {
    name: "Xintianhong (新天鸿名人)",
    club: "上海新天鸿名人高尔夫俱乐部",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", yardage: 6950, par: 72, cr: 74.0, slope: 130 },
      { name: "Blue", colour: "Blue", yardage: 6520, par: 72, cr: 72.4, slope: 127 },
      { name: "White", colour: "White", yardage: 6060, par: 72, cr: 70.6, slope: 122 },
      { name: "Red", colour: "Red", yardage: 5400, par: 72, cr: 68.1, slope: 116 },
    ],
  },
  {
    name: "Dongzhuang Coast (东庄海岸)",
    club: "上海东庄海岸高尔夫俱乐部",
    verified: false,
    source: "trial-import",
    tees: [
      { name: "Black", colour: "Black", yardage: 7000, par: 72, cr: 74.2, slope: 131 },
      { name: "Blue", colour: "Blue", yardage: 6560, par: 72, cr: 72.5, slope: 127 },
      { name: "White", colour: "White", yardage: 6080, par: 72, cr: 70.6, slope: 123 },
      { name: "Red", colour: "Red", yardage: 5420, par: 72, cr: 68.2, slope: 116 },
    ],
  },
];

// ═══════════════ Run ═══════════════

const tx = db.transaction(() => {
  // Replace all existing courses (tees cascade via FK)
  const removed = db.prepare("SELECT COUNT(*) AS c FROM courses").get() as { c: number };
  db.prepare("DELETE FROM tees").run();
  db.prepare("DELETE FROM courses").run();

  for (const c of courses) {
    const courseId = uid();
    db.prepare("INSERT INTO courses (id, name, club, verified, source) VALUES (?, ?, ?, ?, ?)")
      .run(courseId, c.name, c.club, c.verified ? 1 : 0, c.source);
    for (const t of c.tees) {
      const frontCr = Math.round((t.cr / 2) * 10) / 10;
      const backCr = frontCr;
      db.prepare(`INSERT INTO tees (id, course_id, name, colour, yardage, par, cr, slope, cr9, slope9, front_cr, front_slope, back_cr, back_slope)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uid(), courseId, t.name, t.colour, t.yardage, t.par, t.cr, t.slope,
          Math.round((t.cr / 2) * 10) / 10, t.slope, frontCr, t.slope, backCr, t.slope);
    }
  }

  return removed.c;
});

try {
  const removedCount = tx();
  const count = db.prepare("SELECT COUNT(*) AS c FROM courses").get() as { c: number };
  console.log(`Seeded ${count.c} Shanghai courses (replaced ${removedCount} old courses).`);
  console.log("Verified (real rating data): Sheshan International, Shanghai Links, Yintao, Sun Island");
  console.log("The rest are marked ESTIMATED until official rating data is entered.");
} catch (err) {
  console.error("Seed failed:", err);
  process.exit(1);
}
