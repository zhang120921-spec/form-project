# FORM v3 — Know where you stand

A full-stack golf form-rating web application adapting the Elo chess rating system for golfers.

## Architecture

```
form-v3/
├── engine/          # Pure TypeScript rating engine (zero deps, runs in Node & browser)
│   └── index.ts     # All formulas, replay, WHS handicap, forecast scoring
├── store/
│   └── interface.ts # FormStore data-access interface (30+ methods)
├── server/          # Hono + SQLite backend
│   └── src/
│       ├── index.ts         # REST API (auth, friends, rounds, replay, etc.)
│       ├── middleware/auth.ts # JWT + argon2 authentication
│       └── db/
│           ├── connection.ts  # SQLite with WAL mode
│           ├── schema.ts      # Full schema with migrations
│           └── seed.ts        # Demo data (admin, 13 players, 34 rounds)
└── web/             # Vite + React + TypeScript client
    └── src/
        ├── components/  # Header, PlayerCard, RoundCard, LogRoundForm, MathsOverlay
        ├── pages/       # Overview, Rankings, Rounds, Log, Profile, Friends, Auth
        ├── hooks/       # useAuth, useReplay, useRounds, useFriends, etc.
        ├── lib/         # API client, theme, types
        └── styles/      # Scorecard design tokens & global CSS
```

## Quick Start

### 1. Server

```bash
cd server
npm install
npm run db:migrate    # Create tables
npm run db:seed       # Load demo data (admin@form.golf / admin123)
npm run dev           # Start on http://localhost:3001
```

Or use the **Admin Console** at http://localhost:3001/admin (login with `admin@form.golf` / `admin123`) to run these steps with buttons.

### 2. Web Client

```bash
cd web
npm install
npm run dev           # Start on http://localhost:5173
```

### 3. Open

Navigate to http://localhost:5173 and sign in. Test accounts:

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| Admin | `admin@form.golf` | `admin123` | Full admin access |
| Demo players | `<name>@demo.golf` | `golf123` | 8 players (You, Darren, Wei, Marcus, Aaron, Jun, Priya, Sam) |
| Test bots | `<name>@form.golf` | `botgolf123` | 5 bots (James, Kenji, Sarah, Tom, Lisa) — searchable, friendable, with rounds |

## Design System

**Scorecard** — warm paper ground (#F7F4EE), amber accent (#C2853B), zero radius, ruled lines, 18px+ type, fades-only motion (≤200ms), light default with dark toggle.

## Engine

The rating engine is a pure, dependency-free TypeScript module at `engine/index.ts`. It implements:

- Adapted Elo model: `S(m) = 1/(1+e^(−α·m))`
- Format-specific α parameters (α_stroke=0.30, α_match=0.435)
- K-factor with placement period (K=80 first 5 rounds, K=40 after)
- Score Differential: `SD = (AGS − CR − PCC) × 113 / Slope`
- Stableford identity: `AGS = Par + 36 − Points`
- Nine-hole scaling: `α_n = α₁₈ × √(18/n)`, `K_n = K × (n/18)`
- Deterministic replay — ratings never stored, always recomputed

## Key Features

| # | Feature | Status |
|---|---------|--------|
| 1 | User accounts (JWT + argon2) | ✅ |
| 2 | Backend (Hono + SQLite) | ✅ |
| 3 | Friends (request/accept/decline) | ✅ |
| 4 | Attestation (confirm/dispute) | ✅ |
| 5 | Admin (users CRUD, stats, health, commands) | ✅ |
| 6 | Courses (CR/Slope per tee) | ✅ |
| 7 | AI narrator | ⬜ |
| 8 | Fair-match calculator | ⬜ |
| 9 | Matchmaking | ⬜ |
| 10 | OCR scorecard | ⬜ |
| 11 | Forecast accuracy | ⬜ |
| 12 | Sandbag immunity | ⬜ |
| 13 | Anomaly detection | ⬜ |
| 14 | Rivalries | ⬜ |
| 15 | Connection graph | ⬜ |
| 16 | Season recap | ⬜ |

## License

Private — built for FORM.
