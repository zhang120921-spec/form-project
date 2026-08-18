// Seed script: creates realistic-looking user accounts, builds a friend
// network, and logs golf rounds through the API so the ELO engine
// processes everything naturally.
//
// Usage: npx tsx src/db/seed-real.ts
//
// After running this, the app will show real engine-computed ratings,
// form, and match suggestions — no hardcoded demo data.

import crypto from "crypto";
import { hash } from "argon2";
import db from "./connection.js";
import { runMigrations } from "./schema.js";

const uid = () => crypto.randomUUID();

// ═══ Helpers ═══
async function fetchAPI(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(`http://localhost:3001${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} — ${json.error || JSON.stringify(json)}`);
  return json;
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetchAPI("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  return res.token;
}

// ═══ Main ═══
async function main() {
  runMigrations();

  // ═══ Step 1: Define all players ═══
  // mike's direct friends (6)
  const mikeFriends = [
    { displayName: "John Chen", email: "john.chen@outlook.com", sgaHandicap: 12.4, homeClub: "SICC" },
    { displayName: "David Lim", email: "david.lim@yahoo.com", sgaHandicap: 8.1, homeClub: "Tanah Merah CC" },
    { displayName: "Marcus Tan", email: "marcus.tan@gmail.com", sgaHandicap: 15.7, homeClub: "Laguna National" },
    { displayName: "Ryan Ng", email: "ryan.ngs@gmail.com", sgaHandicap: 10.0, homeClub: "Sentosa GC" },
    { displayName: "Adrian Koh", email: "adrian.koh@outlook.sg", sgaHandicap: 6.3, homeClub: "Warren GC" },
    { displayName: "Kelvin Wong", email: "kelvin.wongg@yahoo.sg", sgaHandicap: 11.2, homeClub: "Seletar CC" },
  ];

  // Extended network — connected through mike's friends
  const extendedNetwork = [
    { displayName: "Bryan Lee", email: "bryan.lee88@gmail.com", sgaHandicap: 9.5, homeClub: "Orchid CC" },
    { displayName: "Desmond Chua", email: "desmond.chua@outlook.sg", sgaHandicap: 14.0, homeClub: "NSRCC" },
    { displayName: "Eugene Tan", email: "eugene.tan@yahoo.sg", sgaHandicap: 7.8, homeClub: "TMCC" },
    { displayName: "Francis Lim", email: "francis.lim@gmail.com", sgaHandicap: 18.2, homeClub: "MBGC" },
    { displayName: "Gary Teo", email: "gary.teo@hotmail.com", sgaHandicap: 5.5, homeClub: "Champions" },
    { displayName: "Henry Ong", email: "henry.ong@outlook.sg", sgaHandicap: 13.1, homeClub: "JCC" },
    { displayName: "Ian Koh", email: "ian.kohh@gmail.com", sgaHandicap: 10.5, homeClub: "Raffles CC" },
    { displayName: "Jason Yeo", email: "jason.yeo@yahoo.sg", sgaHandicap: 16.3, homeClub: "Seletar CC" },
    { displayName: "Keith Soh", email: "keith.soh@outlook.com", sgaHandicap: 8.0, homeClub: "Keppel Club" },
    { displayName: "Leonard Ng", email: "leonard.ng@gmail.com", sgaHandicap: 9.8, homeClub: "Sembawang CC" },
    { displayName: "Nigel Chang", email: "nigel.chang@hotmail.sg", sgaHandicap: 12.0, homeClub: "SICC" },
    { displayName: "Peter Goh", email: "peter.goh@gmail.com", sgaHandicap: 7.2, homeClub: "Laguna National" },
  ];

  const allPlayers = [...mikeFriends, ...extendedNetwork];
  const playerMap: Record<string, string> = {};
  const passwordHash = await hash("golf123");

  console.log("=== Creating player accounts ===\n");

  for (const p of allPlayers) {
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(p.email) as { id: string } | undefined;
    if (existing) {
      console.log(`  ↻ ${p.displayName} already exists`);
      playerMap[p.email] = existing.id;
    } else {
      const id = uid();
      db.prepare(`
        INSERT INTO users (id, email, password_hash, display_name, home_club, sga_handicap, is_public)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(id, p.email, passwordHash, p.displayName, p.homeClub, p.sgaHandicap);
      playerMap[p.email] = id;
      console.log(`  ✓ ${p.displayName} (${p.email}) — ${p.homeClub}, HCP ${p.sgaHandicap}`);
    }
  }

  // ═══ Step 2: Get mike ═══
  const mike = db.prepare("SELECT id FROM users WHERE email = ?").get("michaelz.zhanghan@gmail.com") as { id: string } | undefined;
  if (!mike) { console.error("mike account not found!"); process.exit(1); }
  const mikeId = mike.id;
  db.prepare("UPDATE users SET sga_handicap = 9.5 WHERE id = ?").run(mikeId);

  // ═══ Step 3: Friendships ═══
  console.log("\n=== Creating friendships ===\n");

  function addFriendship(a: string, b: string, label?: string) {
    const idA = a === "mike" ? mikeId : playerMap[a];
    const idB = b === "mike" ? mikeId : playerMap[b];
    if (!idA || !idB) return;
    const existing = db.prepare("SELECT id FROM friendships WHERE user_id = ? AND friend_id = ?").get(idA, idB);
    if (!existing) {
      db.prepare("INSERT INTO friendships (id, user_id, friend_id) VALUES (?, ?, ?)").run(uid(), idA, idB);
      db.prepare("INSERT INTO friendships (id, user_id, friend_id) VALUES (?, ?, ?)").run(uid(), idB, idA);
      if (label) console.log(`  ✓ ${label}`);
    }
  }

  // mike ↔ his 6 friends
  for (const f of mikeFriends) {
    addFriendship("mike", f.email, `mike ↔ ${f.displayName}`);
  }

  // Cross-friendships — who knows whom in the extended network
  const crossFriendships: [string, string][] = [
    // John's circle
    ["john.chen@outlook.com", "david.lim@yahoo.com"],
    ["john.chen@outlook.com", "ryan.ngs@gmail.com"],
    ["john.chen@outlook.com", "bryan.lee88@gmail.com"],
    ["john.chen@outlook.com", "nigel.chang@hotmail.sg"],
    // David's circle
    ["david.lim@yahoo.com", "keith.soh@outlook.com"],
    ["david.lim@yahoo.com", "peter.goh@gmail.com"],
    ["david.lim@yahoo.com", "leonard.ng@gmail.com"],
    // Marcus's circle
    ["marcus.tan@gmail.com", "desmond.chua@outlook.sg"],
    ["marcus.tan@gmail.com", "jason.yeo@yahoo.sg"],
    // Ryan's circle
    ["ryan.ngs@gmail.com", "bryan.lee88@gmail.com"],
    ["ryan.ngs@gmail.com", "eugene.tan@yahoo.sg"],
    // Adrian's circle
    ["adrian.koh@outlook.sg", "gary.teo@hotmail.com"],
    ["adrian.koh@outlook.sg", "peter.goh@gmail.com"],
    ["adrian.koh@outlook.sg", "keith.soh@outlook.com"],
    // Kelvin's circle
    ["kelvin.wongg@yahoo.sg", "henry.ong@outlook.sg"],
    ["kelvin.wongg@yahoo.sg", "ian.kohh@gmail.com"],
    ["kelvin.wongg@yahoo.sg", "jason.yeo@yahoo.sg"],
    // Extended network among themselves
    ["eugene.tan@yahoo.sg", "peter.goh@gmail.com"],
    ["eugene.tan@yahoo.sg", "keith.soh@outlook.com"],
    ["ian.kohh@gmail.com", "nigel.chang@hotmail.sg"],
    ["ian.kohh@gmail.com", "henry.ong@outlook.sg"],
    ["leonard.ng@gmail.com", "nigel.chang@hotmail.sg"],
    ["francis.lim@gmail.com", "desmond.chua@outlook.sg"],
    ["francis.lim@gmail.com", "jason.yeo@yahoo.sg"],
    // Additional interconnections for round coverage
    ["desmond.chua@outlook.sg", "jason.yeo@yahoo.sg"],
    ["eugene.tan@yahoo.sg", "nigel.chang@hotmail.sg"],
    ["leonard.ng@gmail.com", "ian.kohh@gmail.com"],
    ["leonard.ng@gmail.com", "henry.ong@outlook.sg"],
    ["gary.teo@hotmail.com", "peter.goh@gmail.com"],
    ["gary.teo@hotmail.com", "keith.soh@outlook.com"],
    ["henry.ong@outlook.sg", "nigel.chang@hotmail.sg"],
    ["kelvin.wongg@yahoo.sg", "nigel.chang@hotmail.sg"],
    ["bryan.lee88@gmail.com", "henry.ong@outlook.sg"],
    ["bryan.lee88@gmail.com", "eugene.tan@yahoo.sg"],
  ];
  for (const [e1, e2] of crossFriendships) {
    const n1 = allPlayers.find(p => p.email === e1)?.displayName || e1;
    const n2 = allPlayers.find(p => p.email === e2)?.displayName || e2;
    addFriendship(e1, e2, `${n1} ↔ ${n2}`);
  }

  // ═══ Step 4: Login as mike ═══
  console.log("\n=== Logging rounds ===\n");
  const pwdHash2 = await hash("password");
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(pwdHash2, mikeId);
  const mikeToken = await login("michaelz.zhanghan@gmail.com", "password");

  // ID shortcuts for round participant definitions
  const J = playerMap["john.chen@outlook.com"]!;
  const D = playerMap["david.lim@yahoo.com"]!;
  const M = playerMap["marcus.tan@gmail.com"]!;
  const R = playerMap["ryan.ngs@gmail.com"]!;
  const A = playerMap["adrian.koh@outlook.sg"]!;
  const K = playerMap["kelvin.wongg@yahoo.sg"]!;
  const B = playerMap["bryan.lee88@gmail.com"]!;
  const De = playerMap["desmond.chua@outlook.sg"]!;
  const E = playerMap["eugene.tan@yahoo.sg"]!;
  const F = playerMap["francis.lim@gmail.com"]!;
  const G = playerMap["gary.teo@hotmail.com"]!;
  const H = playerMap["henry.ong@outlook.sg"]!;
  const I = playerMap["ian.kohh@gmail.com"]!;
  const Ja = playerMap["jason.yeo@yahoo.sg"]!;
  const Ke = playerMap["keith.soh@outlook.com"]!;
  const L = playerMap["leonard.ng@gmail.com"]!;
  const N = playerMap["nigel.chang@hotmail.sg"]!;
  const P = playerMap["peter.goh@gmail.com"]!;

  // ═══ Round definitions — 25 rounds ═══
  interface StrokePart { playerId: string; ags: number; cr: number; slope: number }
  interface MatchPart { playerId: string; holesWon: number; cr: number; slope: number }
  type AnyPart = StrokePart | MatchPart;
  interface RoundDef { date: string; course: string; format: string; loggedBy: string; participants: AnyPart[] }

  const rounds: RoundDef[] = [
    // ═══ 10 rounds logged by mike (only his 6 friends) ═══
    { date: "2026-07-08", course: "Sentosa (Serapong)", format: "stroke", loggedBy: "mike",
      participants: [
        { playerId: mikeId, ags: 86, cr: 72.0, slope: 130 },
        { playerId: J, ags: 88, cr: 72.0, slope: 130 },
        { playerId: D, ags: 77, cr: 72.0, slope: 130 },
      ]},
    { date: "2026-07-11", course: "Tanah Merah (Tampines)", format: "stroke", loggedBy: "mike",
      participants: [
        { playerId: mikeId, ags: 82, cr: 71.4, slope: 125 },
        { playerId: D, ags: 76, cr: 71.4, slope: 125 },
        { playerId: A, ags: 79, cr: 71.4, slope: 125 },
      ]},
    { date: "2026-07-14", course: "Laguna National (Classic)", format: "stroke", loggedBy: "mike",
      participants: [
        { playerId: mikeId, ags: 85, cr: 73.1, slope: 138 },
        { playerId: R, ags: 83, cr: 73.1, slope: 138 },
        { playerId: K, ags: 87, cr: 73.1, slope: 138 },
      ]},
    { date: "2026-07-17", course: "Singapore Island CC", format: "stroke", loggedBy: "mike",
      participants: [
        { playerId: mikeId, ags: 80, cr: 72.5, slope: 131 },
        { playerId: J, ags: 84, cr: 72.5, slope: 131 },
        { playerId: M, ags: 91, cr: 72.5, slope: 131 },
        { playerId: R, ags: 82, cr: 72.5, slope: 131 },
      ]},
    { date: "2026-07-20", course: "Sentosa (New Tanjong)", format: "stroke", loggedBy: "mike",
      participants: [
        { playerId: mikeId, ags: 81, cr: 71.2, slope: 128 },
        { playerId: D, ags: 78, cr: 71.2, slope: 128 },
        { playerId: A, ags: 80, cr: 71.2, slope: 128 },
        { playerId: J, ags: 85, cr: 71.2, slope: 128 },
      ]},
    { date: "2026-07-23", course: "Marina Bay Golf Course", format: "stroke", loggedBy: "mike",
      participants: [
        { playerId: mikeId, ags: 83, cr: 72.1, slope: 133 },
        { playerId: K, ags: 86, cr: 72.1, slope: 133 },
        { playerId: M, ags: 90, cr: 72.1, slope: 133 },
      ]},
    { date: "2026-07-26", course: "Keppel Club", format: "stroke", loggedBy: "mike",
      participants: [
        { playerId: mikeId, ags: 79, cr: 70.8, slope: 124 },
        { playerId: R, ags: 81, cr: 70.8, slope: 124 },
        { playerId: J, ags: 82, cr: 70.8, slope: 124 },
      ]},
    { date: "2026-07-29", course: "Warren GC", format: "stroke", loggedBy: "mike",
      participants: [
        { playerId: mikeId, ags: 84, cr: 71.5, slope: 127 },
        { playerId: J, ags: 86, cr: 71.5, slope: 127 },
        { playerId: D, ags: 79, cr: 71.5, slope: 127 },
        { playerId: A, ags: 78, cr: 71.5, slope: 127 },
      ]},
    { date: "2026-08-01", course: "Seletar CC", format: "stroke", loggedBy: "mike",
      participants: [
        { playerId: mikeId, ags: 78, cr: 70.6, slope: 122 },
        { playerId: K, ags: 84, cr: 70.6, slope: 122 },
        { playerId: M, ags: 89, cr: 70.6, slope: 122 },
      ]},
    { date: "2026-08-03", course: "SICC", format: "match", loggedBy: "mike",
      participants: [
        { playerId: mikeId, holesWon: 5, cr: 72.4, slope: 132 },
        { playerId: D, holesWon: 4, cr: 72.4, slope: 132 },
      ]},

    // ═══ 8 rounds logged by friends (mike is a participant) ═══
    { date: "2026-07-10", course: "SICC", format: "stroke", loggedBy: "john.chen@outlook.com",
      participants: [
        { playerId: J, ags: 87, cr: 72.4, slope: 132 },
        { playerId: mikeId, ags: 83, cr: 72.4, slope: 132 },
        { playerId: R, ags: 85, cr: 72.4, slope: 132 },
        { playerId: B, ags: 86, cr: 72.4, slope: 132 },
      ]},
    { date: "2026-07-15", course: "Tanah Merah (Garden)", format: "stroke", loggedBy: "david.lim@yahoo.com",
      participants: [
        { playerId: D, ags: 77, cr: 71.0, slope: 123 },
        { playerId: mikeId, ags: 82, cr: 71.0, slope: 123 },
        { playerId: Ke, ags: 81, cr: 71.0, slope: 123 },
        { playerId: P, ags: 80, cr: 71.0, slope: 123 },
      ]},
    { date: "2026-07-18", course: "Raffles CC", format: "stroke", loggedBy: "adrian.koh@outlook.sg",
      participants: [
        { playerId: A, ags: 78, cr: 71.6, slope: 130 },
        { playerId: mikeId, ags: 86, cr: 71.6, slope: 130 },
        { playerId: G, ags: 79, cr: 71.6, slope: 130 },
      ]},
    { date: "2026-07-22", course: "JCC", format: "stroke", loggedBy: "kelvin.wongg@yahoo.sg",
      participants: [
        { playerId: K, ags: 85, cr: 72.2, slope: 135 },
        { playerId: mikeId, ags: 81, cr: 72.2, slope: 135 },
        { playerId: I, ags: 84, cr: 72.2, slope: 135 },
        { playerId: N, ags: 87, cr: 72.2, slope: 135 },
      ]},
    { date: "2026-07-25", course: "Sentosa (Serapong)", format: "stroke", loggedBy: "ryan.ngs@gmail.com",
      participants: [
        { playerId: R, ags: 83, cr: 72.0, slope: 130 },
        { playerId: mikeId, ags: 80, cr: 72.0, slope: 130 },
        { playerId: B, ags: 85, cr: 72.0, slope: 130 },
        { playerId: E, ags: 81, cr: 72.0, slope: 130 },
      ]},
    { date: "2026-07-28", course: "Champions GC", format: "match", loggedBy: "adrian.koh@outlook.sg",
      participants: [
        { playerId: A, holesWon: 3, cr: 70.3, slope: 120 },
        { playerId: mikeId, holesWon: 2, cr: 70.3, slope: 120 },
      ]},
    { date: "2026-07-31", course: "Laguna National (Classic)", format: "stroke", loggedBy: "david.lim@yahoo.com",
      participants: [
        { playerId: D, ags: 79, cr: 73.1, slope: 138 },
        { playerId: mikeId, ags: 84, cr: 73.1, slope: 138 },
        { playerId: P, ags: 80, cr: 73.1, slope: 138 },
        { playerId: L, ags: 86, cr: 73.1, slope: 138 },
      ]},
    { date: "2026-08-02", course: "MBGC", format: "stroke", loggedBy: "marcus.tan@gmail.com",
      participants: [
        { playerId: M, ags: 92, cr: 71.9, slope: 128 },
        { playerId: mikeId, ags: 83, cr: 71.9, slope: 128 },
        { playerId: De, ags: 93, cr: 71.9, slope: 128 },
      ]},

    // ═══ 7 rounds without mike (extended network) ═══
    { date: "2026-07-12", course: "NSRCC", format: "stroke", loggedBy: "desmond.chua@outlook.sg",
      participants: [
        { playerId: De, ags: 91, cr: 71.3, slope: 126 },
        { playerId: Ja, ags: 94, cr: 71.3, slope: 126 },
        { playerId: F, ags: 96, cr: 71.3, slope: 126 },
      ]},
    { date: "2026-07-16", course: "TMCC", format: "stroke", loggedBy: "eugene.tan@yahoo.sg",
      participants: [
        { playerId: E, ags: 80, cr: 72.8, slope: 134 },
        { playerId: Ke, ags: 82, cr: 72.8, slope: 134 },
        { playerId: N, ags: 85, cr: 72.8, slope: 134 },
      ]},
    { date: "2026-07-19", course: "Sembawang CC", format: "stroke", loggedBy: "leonard.ng@gmail.com",
      participants: [
        { playerId: L, ags: 84, cr: 71.9, slope: 128 },
        { playerId: I, ags: 83, cr: 71.9, slope: 128 },
        { playerId: H, ags: 88, cr: 71.9, slope: 128 },
        { playerId: N, ags: 86, cr: 71.9, slope: 128 },
      ]},
    { date: "2026-07-24", course: "Marina Bay Golf Course", format: "stroke", loggedBy: "bryan.lee88@gmail.com",
      participants: [
        { playerId: B, ags: 84, cr: 72.1, slope: 133 },
        { playerId: E, ags: 79, cr: 72.1, slope: 133 },
        { playerId: H, ags: 87, cr: 72.1, slope: 133 },
      ]},
    { date: "2026-07-27", course: "Seletar CC", format: "stroke", loggedBy: "jason.yeo@yahoo.sg",
      participants: [
        { playerId: Ja, ags: 92, cr: 70.6, slope: 122 },
        { playerId: F, ags: 95, cr: 70.6, slope: 122 },
        { playerId: De, ags: 90, cr: 70.6, slope: 122 },
      ]},
    { date: "2026-07-30", course: "Warren GC", format: "stroke", loggedBy: "gary.teo@hotmail.com",
      participants: [
        { playerId: G, ags: 77, cr: 71.5, slope: 127 },
        { playerId: Ke, ags: 80, cr: 71.5, slope: 127 },
        { playerId: P, ags: 79, cr: 71.5, slope: 127 },
      ]},
    { date: "2026-08-01", course: "Orchid CC", format: "stroke", loggedBy: "henry.ong@outlook.sg",
      participants: [
        { playerId: H, ags: 88, cr: 71.8, slope: 129 },
        { playerId: I, ags: 83, cr: 71.8, slope: 129 },
        { playerId: N, ags: 86, cr: 71.8, slope: 129 },
      ]},
  ];

  // ═══ Pre-login all players ═══
  const tokenCache: Record<string, string> = { mike: mikeToken };

  console.log("\n=== Logging in all players ===\n");
  for (const p of allPlayers) {
    try {
      await new Promise(r => setTimeout(r, 200));
      tokenCache[p.email] = await login(p.email, "golf123");
      console.log(`  ✓ ${p.displayName}`);
    } catch (e: any) {
      console.error(`  ✗ ${p.displayName}: ${e.message}`);
    }
  }

  async function getToken(loggedBy: string): Promise<string> {
    if (loggedBy === "mike") return mikeToken;
    const t = tokenCache[loggedBy];
    if (!t) throw new Error(`No token for ${loggedBy}`);
    return t;
  }

  // ═══ Log rounds via API ═══
  console.log("\n=== Logging rounds ===\n");
  let ok = 0;
  let fail = 0;

  for (const r of rounds) {
    try {
      await new Promise(r => setTimeout(r, 150)); // gentle pacing
      const token = await getToken(r.loggedBy);
      const res = await fetch("http://localhost:3001/api/rounds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          date: r.date,
          course: r.course,
          format: r.format,
          participants: r.participants,
        }),
      });
      const data = await res.json() as any;
      if (res.status === 201 && data.id) {
        ok++;
        console.log(`  ✓ ${r.date} — ${r.course} (${r.format}, ${r.participants.length}P, by ${r.loggedBy})`);
      } else {
        fail++;
        console.error(`  ✗ ${r.course}: ${JSON.stringify(data)}`);
      }
    } catch (e: any) {
      fail++;
      console.error(`  ✗ ${r.course}: ${e.message}`);
    }
  }

  console.log(`\n${ok} rounds logged, ${fail} failed`);

  if (fail > 0) {
    console.error("\nSome rounds failed — stopping before attestations.");
    process.exit(1);
  }

  // ═══ Step 5: Accept all pending attestations ═══
  console.log("\n=== Accepting attestations ===\n");

  for (const p of allPlayers) {
    try {
      const token = await getToken(p.email);
      const attestations = await fetchAPI("/api/attestations", { token: token }) as any[];

      for (const a of attestations) {
        try {
          await fetchAPI(`/api/attestations/${a.id}/confirm`, {
            method: "POST",
            token: token,
          });
          console.log(`  ✓ ${p.displayName} confirmed round ${(a.round_id as string)?.slice(0, 8)}...`);
        } catch (e: any) {
          console.error(`  ✗ Attestation ${a.id} for ${p.displayName}: ${e.message}`);
        }
      }
    } catch (e: any) {
      console.error(`  ! ${p.email}: ${e.message}`);
    }
  }

  // ═══ Summary ═══
  console.log("\n═════════════════════════════════════");
  console.log("🌴 Dusk v3 — Seed Complete");
  console.log("═════════════════════════════════════");
  console.log(`Players: 1 (mike) + ${allPlayers.length} = ${allPlayers.length + 1} total`);
  console.log(`mike's friends: ${mikeFriends.length} — ${mikeFriends.map(f => f.displayName).join(", ")}`);
  console.log(`Extended network: ${extendedNetwork.length} other players`);
  console.log(`Rounds: ${rounds.length} (${rounds.filter(r => r.format === 'stroke').length} stroke, ${rounds.filter(r => r.format === 'match').length} match)`);
  console.log("\nPasswords: all fake users → 'golf123' | mike → 'password'");
  console.log("http://localhost:5173\n");
}

main().catch(console.error);
