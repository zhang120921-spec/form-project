# Feature status audit — 2026-08-18

The README's feature table marked 10 of 16 features as unbuilt (⬜). A direct
audit of the actual server routes, store interface, and frontend hooks found
that was badly out of date: 9 of those 10 were already implemented and wired
end-to-end. Only one — anomaly detection — was genuinely missing a connection
between real backend logic and the rest of the app, and that gap is closed as
of this session. This doc records what was actually found, so the status
table doesn't drift again.

## What was already real (contrary to the old README)

| Feature | Evidence |
|---|---|
| AI narrator | `POST /api/ai/narrate`, `useNarrator` hook, called from round detail UI |
| Fair-match calculator | `web/src/lib/fair-match.ts` (real math, deriving strokes from live α — never hardcoded) + `FairMatchPage.tsx` wired to real courses/rounds/replay data, not mocks |
| Matchmaking | `POST /api/ai/match-suggestions`, `useMatchSuggestions` hook, surfaced on `OverviewPage` |
| OCR scorecard | `POST /api/ai/ocr-scorecard`, called from `ScorecardCapture.tsx` |
| Sandbag-proof explainer | `SandbagPage.tsx` + `web/src/lib/sandbag-sim.ts` — a real, deterministic side-by-side simulation run through the actual rating engine (not fabricated numbers) |
| Rivalries | `web/src/lib/rivalries.ts` (301 lines, aggregates the engine's real pairwise round results) + `RivalryCard.tsx` |
| Connection graph | `web/src/lib/connectivity.ts` — opponent-diversity warnings in plain language, wired into `ProfilePage.tsx` and `FriendsPage.tsx` |
| Season recap | `GET /api/ai/season-recap/:playerId`, `useSeasonRecap` hook, `SeasonRecapSections.tsx` |

## What was genuinely missing: anomaly detection

The statistical detection logic itself was real and reasonable —
`server/src/ai/routes.ts` had a `/detect-anomalies` route that flags:
1. A score more than 2 standard deviations better than a player's trailing
   5-round average (self-relative, never compared to opponents).
2. A rating gain more than 3x a player's typical per-round swing and over
   10 points.

But nothing ever called it. No frontend hook, no page, and — separately —
`GET /api/rounds` never joined the `ai_analysis` table into its response even
though the `RoundRecord.aiAnalysis` field existed in the type and the store
layer expected it. The data model anticipated this feature; the wiring
didn't exist.

**Fixed this session:**
- Extracted the statistical logic into `engine/anomaly.ts` as a pure,
  tested function (`engine/anomaly.test.ts`, 9 cases), consistent with how
  `fair-match.ts` and `sandbag-sim.ts` already keep math shared and
  drift-proof rather than duplicated.
- `server/src/ai/routes.ts` now calls that shared function via an exported
  `runAnomalyDetectionForUser(userId)`.
- **Detection now runs automatically** when a round becomes fully confirmed
  (in the attestation-confirm handler in `server/src/index.ts`), for every
  participant — not just on-demand when a user happens to call the AI
  endpoint themselves, which nothing ever did.
- `GET /api/rounds` and `GET /api/rounds/:id` now join `ai_analysis` into
  their response, so `RoundRecord.aiAnalysis.flagged` / `.flagReason` are
  actually populated and ready for a UI to read — that UI is intentionally
  not built yet, per current scope.

**Scoped out for now:** anomaly detection only runs against the server-backed
store (`ServerStore`). `LocalStore` (offline/IndexedDB mode) does not
compute anomalies locally — the primary near-term deployment is the
Shanghai academy trial against the live server, so this was not worth the
added surface area yet. Worth revisiting if offline-first usage becomes
important later.

## The one real remaining gap: forecast accuracy is admin-only

`GET /api/admin/forecast` and `FormStore.getForecastAccuracy()` are real and
correct (Brier score, log loss, computed from actual replayed predictions vs
outcomes) — but there is no user-facing surface for it. This is a legitimate
scope decision, not a bug: whether players should see "how well does this
rating predict outcomes" is a product call, not an engineering gap.

## Recommendation for the Shanghai trial timeline

Given the above, the honest scope picture is very different from what the
README implied: there is close to **nothing left to build** at the
functionality layer for the near-term trial. The real remaining work is:

1. **UI for what already exists.** Anomaly flags, rivalries, connectivity
   warnings, and season recaps all have real data now — most just need the
   design pass that's intentionally scoped for later.
2. **Decide, don't build, on forecast accuracy.** Either expose it to users
   (a "how accurate is this rating" transparency feature — arguably fits
   the product's trust-first positioning) or leave it admin-only. No new
   code either way until that's decided.
3. **Do not add new AI features before the trial.** The temptation with a
   list this long is to keep building; resist it. The trial's real risks are
   onboarding ~20 non-technical students, Chinese-language handling, and
   PIPL compliance — not missing functionality.
