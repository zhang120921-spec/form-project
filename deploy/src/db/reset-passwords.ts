import { hash } from "argon2";
import db from "./connection.js";

async function main() {
  const users = db.prepare(
    "SELECT id, email, display_name FROM users WHERE is_admin=0 AND is_pro=0 AND email != 'michaelz.zhanghan@gmail.com'"
  ).all() as any[];
  const pwd = await hash("golf123");

  for (const u of users) {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(pwd, u.id);
    console.log("Reset password: " + u.display_name);
  }
  console.log("Done — " + users.length + " users");
}

main();
