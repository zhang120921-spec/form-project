import db from "./connection.js";
import { runMigrations } from "./schema.js";

runMigrations();
console.log("Migrations complete");

db.close();
