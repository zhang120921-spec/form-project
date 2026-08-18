# UI — FORM Golf App

Everything related to the user interface, collected in one place.

## Structure

```
UI/
├── README.md                ← this file
│
├── frontend/                ← React + TypeScript source (the student-facing app)
│   ├── src/
│   │   ├── App.tsx          ← root component, routes between pages
│   │   ├── main.tsx         ← React entry point
│   │   ├── components/       ← 18 reusable UI components (PlayerCard, RoundCard,
│   │   │                       FormStrip, MathsOverlay, ShareModal, Shell, etc.)
│   │   │                       each with a paired .module.css
│   │   ├── pages/           ← 9 full-page views (Overview, Rankings, Rounds,
│   │   │                       LogRound, FairMatch, Friends, Profile, Auth, Sandbag)
│   │   │                       each with a paired .module.css
│   │   ├── hooks/           ← useAuth, useData, useStore, useAI
│   │   ├── lib/             ← api.ts, i18n.tsx, theme.ts, fair-match.ts,
│   │   │                       handicap.ts, narration.ts, rivalries.ts, types.ts, etc.
│   │   ├── styles/          ← global.css + tokens.css (design tokens / CSS variables)
│   │   └── *.test.ts        ← design-system, palette, features, fair-match, sandbag tests
│   ├── index.html           ← Vite HTML template
│   ├── vite.config.ts       ← Vite build config (singlefile plugin)
│   ├── package.json
│   └── tsconfig*.json
│
├── admin-panel/             ← single-file admin dashboard
│   └── admin.html           ← tabs: Users, Password Resets, AI Config, Courses,
│                               Database, Commands, Health (zh/en toggle)
│
├── served-builds/           ← the actual HTML served to users by the backend
│   └── app.html             ← built frontend (what students see at localhost:3001)
│
├── design-prototype/        ← early standalone design mockup
│   └── form-golf.html       ← the original HTML prototype before React migration
│
└── screenshots/             ← UI screenshots for reference
    ├── screenshot-overview-light.png
    ├── screenshot-overview-dark.png
    ├── screenshot-overview-before-light.png
    ├── screenshot-overview-before-dark.png
    ├── screenshot-overview-after-light.png
    └── screenshot-overview-after-dark.png
```

## How the UI is built and served

1. **Source** lives in `frontend/src/` (React + TypeScript + CSS Modules)
2. **Build**: `cd frontend && npm run build` → Vite compiles everything into a single inline HTML at `frontend/dist/index.html`
3. **Deploy**: that file is copied to `served-builds/app.html` and served by Hono (`server/src/index.ts`) at `http://localhost:3001`
4. **Admin panel**: a standalone single-file HTML at `admin-panel/admin.html`, served at `/admin`

Both paths are resolved relative to `server/src/index.ts` at runtime — if you move `UI/` or `server/`, update the two `path.resolve(__dirname, ...)` calls there.

## Key UI features

- **Bilingual** (English / 中文) with a language toggle — no dark/light theme switch
- **PIPL consent** checkbox on the registration form
- **Chinese round-recap parsing** for Quick Entry (e.g. "Michael 78, Darren 81")
- **Design tokens** in `frontend/src/styles/tokens.css` — all colors, spacing, typography
- **CSS Modules** — each component/page has its own scoped `.module.css`
- **9 pages**: Overview (dashboard), Rankings, Rounds (log/history), Log Round, Fair Match, Friends, Profile, Auth (login/register), Sandbag (detector)

## To rebuild the UI

```bash
cd UI/frontend
npm install        # first time only
npm run build       # outputs to UI/frontend/dist/index.html
cp dist/index.html ../served-builds/app.html   # deploy to server
```
