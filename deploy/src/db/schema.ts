// Database schema — SQLite syntax, documented for Postgres portability
import db from "./connection.js";

export function runMigrations() {
  db.exec(`
    -- Users
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      home_club TEXT,
      region TEXT,
      sga_handicap REAL,
      is_admin INTEGER DEFAULT 0,
      is_suspended INTEGER DEFAULT 0,
      is_public INTEGER DEFAULT 0,
      is_pro INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Sessions (JWT refresh tokens stored here)
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Password reset tokens
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Courses
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      club TEXT,
      verified INTEGER DEFAULT 0,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Tees
    CREATE TABLE IF NOT EXISTS tees (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      colour TEXT NOT NULL,
      yardage INTEGER,
      par INTEGER NOT NULL,
      cr REAL NOT NULL,
      slope INTEGER NOT NULL,
      cr9 REAL,
      slope9 INTEGER,
      front_cr REAL,
      front_slope INTEGER,
      back_cr REAL,
      back_slope INTEGER
    );

    -- Rounds (raw input only — never stores computed ratings)
    CREATE TABLE IF NOT EXISTS rounds (
      id TEXT PRIMARY KEY,
      logged_by TEXT NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      format TEXT NOT NULL CHECK(format IN ('stroke','match','stableford')),
      course TEXT NOT NULL,
      par INTEGER DEFAULT 72,
      holes INTEGER DEFAULT 18,
      nine TEXT DEFAULT '18',
      status TEXT NOT NULL DEFAULT 'pending_attestation'
        CHECK(status IN ('pending_attestation','confirmed','disputed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Round participants (raw scores)
    CREATE TABLE IF NOT EXISTS round_participants (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES users(id),
      ags REAL,
      holes_won INTEGER,
      points INTEGER,
      cr REAL NOT NULL,
      slope REAL NOT NULL,
      pcc REAL DEFAULT 0
    );

    -- Friendships (bidirectional, confirmed only)
    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      friend_id TEXT NOT NULL REFERENCES users(id),
      is_regular INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, friend_id)
    );

    -- Friend requests
    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL REFERENCES users(id),
      to_id TEXT NOT NULL REFERENCES users(id),
      message TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','accepted','declined','cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Attestations
    CREATE TABLE IF NOT EXISTS attestations (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
      from_id TEXT NOT NULL REFERENCES users(id),
      to_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','confirmed','disputed','expired')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      confirmed_at TEXT
    );

    -- Play invitations (invite a friend to play golf)
    CREATE TABLE IF NOT EXISTS play_invitations (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL REFERENCES users(id),
      to_id TEXT NOT NULL REFERENCES users(id),
      message TEXT DEFAULT '',
      proposed_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','accepted','declined')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(from_id, to_id, proposed_date)
    );

    -- AI analysis cache (generated once at commit, cached)
    CREATE TABLE IF NOT EXISTS ai_analysis (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
      narration TEXT,
      flagged INTEGER DEFAULT 0,
      flag_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Forecast accuracy cache
    CREATE TABLE IF NOT EXISTS forecast_cache (
      id TEXT PRIMARY KEY,
      computed_at TEXT NOT NULL DEFAULT (datetime('now')),
      form_error REAL,
      hcp_error REAL,
      form_brier REAL,
      hcp_brier REAL,
      total_rounds INTEGER
    );

    -- Config (application-level, single row with key)
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_rounds_player ON round_participants(player_id);
    CREATE INDEX IF NOT EXISTS idx_rounds_date ON rounds(date);
    CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);
    CREATE INDEX IF NOT EXISTS idx_friend_requests_from ON friend_requests(from_id);
    CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_id);
    CREATE INDEX IF NOT EXISTS idx_attestations_to ON attestations(to_id);
    CREATE INDEX IF NOT EXISTS idx_attestations_round ON attestations(round_id);
    CREATE INDEX IF NOT EXISTS idx_play_invitations_from ON play_invitations(from_id);
    CREATE INDEX IF NOT EXISTS idx_play_invitations_to ON play_invitations(to_id);
  `);

  // Insert default config if not exists
  const existing = db.prepare("SELECT key FROM config WHERE key = 'engine'").get();
  if (!existing) {
    db.prepare("INSERT INTO config (key, value) VALUES (?, ?)").run(
      "engine",
      JSON.stringify({
        startRating: 1500,
        anchorHandicap: 18,
        kFloor: 40,
        kPlacement: 80,
        placementMatches: 5,
        alphaStroke: 0.30,
        alphaMatch: 0.435,
        matchStrokeFactor: 1.45,
        handicapMode: "whs",
        rdFloor: 30,
        rdStart: 350,
      })
    );
  }

  // ── Add columns that may be missing on older databases ──
  const userCols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  const userColNames = new Set(userCols.map((c) => c.name));
  if (!userColNames.has("is_public")) {
    db.exec("ALTER TABLE users ADD COLUMN is_public INTEGER DEFAULT 0");
    console.log("Added is_public column to users");
  }
  if (!userColNames.has("is_suspended")) {
    db.exec("ALTER TABLE users ADD COLUMN is_suspended INTEGER DEFAULT 0");
    console.log("Added is_suspended column to users");
  }
  if (!userColNames.has("is_pro")) {
    db.exec("ALTER TABLE users ADD COLUMN is_pro INTEGER DEFAULT 0");
    console.log("Added is_pro column to users");
  }
  // Backfill pro flag for seeded famous players on older databases
  const famousBackfill = db.prepare(
    "UPDATE users SET is_pro = 1, is_public = 1 WHERE email LIKE '%@famous.golf' AND is_pro = 0"
  ).run();
  if (famousBackfill.changes > 0) {
    console.log(`Backfilled is_pro=1 for ${famousBackfill.changes} famous player(s)`);
  }

  const resetCols = db.prepare("PRAGMA table_info(password_resets)").all() as Array<{ name: string }>;
  const resetColNames = new Set(resetCols.map((c) => c.name));
  if (!resetColNames.has("used")) {
    db.exec("ALTER TABLE password_resets ADD COLUMN used INTEGER DEFAULT 0");
    console.log("Added used column to password_resets");
  }

  console.log("Migrations complete");
}

// Run directly
if (process.argv[1]?.includes("migrate")) {
  runMigrations();
  process.exit(0);
}
