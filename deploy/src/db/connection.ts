// Database connection and helpers
import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, "..", "data", "form.db");

// Ensure data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for concurrent reads
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export default db;
