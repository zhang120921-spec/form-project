# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two horizons, both real:

1. **Now:** ~20 real students at a golf academy in Shanghai, about to self-register and use FORM as a group. This is the immediate, concrete deployment — not a hypothetical persona.
2. **Later:** a broader public audience beyond that academy — golfers generally, with a global rankings surface searchable by name/club/region, and friend-group play for people who don't know each other yet.

Design and build decisions should hold up for a real cohort using this soon in China, while not foreclosing the public-product direction it grows into afterward.

## Product Purpose

FORM rates golfers' actual skill using an Elo-style rating system (the "FORM rating") adapted from chess, corrected for handicap. Players log rounds against real golf courses, opponents/friends attest to (vouch for) the reported score, and the rating recomputes deterministically from that verified history — never stored as raw truth. A Fair Match engine pairs players of similar strength. Success means a rating players trust as their true current form, not a stale self-reported handicap.

## Positioning

Core claim: **you cannot fake your score to look better.** Rating is always recomputed from attested round history, so sandbagging (playing down to game a handicap) only depresses your rating and exposes itself — the scoring math prevents gaming rather than relying on manual policing. This differs from ordinary handicap trackers or scorecard apps, which have no verification/trust loop tied to a competitive rating.

## Operating Context

- **Immediate:** a golf academy in Shanghai onboarding ~20 real students. The database is currently seeded with 13 accounts (an admin plus 10 well-known professional players used as rating benchmarks, plus a couple of test accounts) and 18 real Shanghai golf courses with Black/Blue/White/Red tee data loaded — but 0 rounds and 0 friendships, i.e. a clean slate ready for the real students to self-register into.
- **Regulatory/localization constraint:** registration includes a PIPL consent checkbox (China's Personal Information Protection Law) — this is a real compliance requirement, not optional. Round-recap parsing needs to handle Chinese-language input.
- **No email service configured:** password reset is handled offline via the admin console's "Password Resets" tab rather than SMTP — an operational constraint for the trial, not necessarily permanent.
- Post-round logging: manual entry now; photo-scorecard OCR and natural-language/voice entry are designed but not built.
- Friend attestation loop: the other player(s) in a round confirm or dispute a reported score before it affects ratings.
- Admin console (`/admin`): user management (including password resets), course management, system stats/health, operational commands.
- Fair-match calculator: computes handicap strokes and win-probability estimates for a group before a round.
- Season recap: end-of-season summary (rating peaks/troughs, best/worst rounds, most-played course) for sharing.
- Supports stroke play, Stableford, and match play, including 9-hole rounds (scaled formulas).

## Capabilities and Constraints

**Built:**
- Accounts with JWT + argon2 auth, rate-limited login, PIPL consent at registration
- Friends (request/accept/decline)
- Round attestation (confirm/dispute, dispute allows correcting the score)
- Admin console: user CRUD, offline password resets, course management, stats, health, operational commands
- 18 real Shanghai courses loaded with 4 tee sets each (Course Rating/Slope per tee)
- Deterministic rating engine (dependency-free TypeScript): adapted Elo `S(m) = 1/(1+e^(−α·m))`, format-specific α (stroke vs match play), placement-period K-factor (K=80 first 5 rounds, K=40 after), Score Differential formula, Stableford identity, 9-hole scaling, full replay — ratings are always recomputed from round history, never persisted as source of truth.
- Local + server storage behind one shared `FormStore` interface (offline-capable local store, syncing server store)

**Not yet built (planned):** AI round narrator, AI-assisted matchmaking, OCR scorecard capture, forecast-accuracy scoring, sandbag-immunity mechanics, anomaly/suspicious-score detection, rivalry tracking, a friend-connection graph, automated season-recap generation. UI for several of these (fair-match, rivalry cards, sandbag simulator, season recap sections) already exists ahead of the backend logic.

**Undecided:** final product name/brand for the eventual public product, monetization model, whether the product formally supports a coach/instructor role beyond general users.

## Brand Commitments

None locked. "FORM" is the working name used throughout the codebase and in the Shanghai trial; no logo/visual identity is fixed. Open to changing as the product moves from the academy trial toward a public launch. The existing "Scorecard" visual language (warm paper background `#F7F4EE`, amber accent `#C2853B`, zero border-radius, ruled lines, light-default with dark toggle) is an implemented design direction, not a confirmed binding brand commitment.

## Evidence on Hand

No real usage data yet — the trial has not started (0 rounds, 0 friendships). What's real: 18 actual Shanghai golf courses with real tee/rating data, and 10 well-known professional golfers seeded as rating benchmarks (used for comparison, e.g. "how do I compare to a pro"). The admin and a couple of test accounts are operational/dev fixtures, not real users. Prior demo/synthetic data (8 demo players, 5 bots, ~34 synthetic rounds referenced elsewhere in the repo) belongs to an earlier dev fixture set, not the live Shanghai trial, and must not be presented as real users or traction.

## UI

All UI files are consolidated in `UI/`. See `UI/README.md` for the full folder map. Includes:
- `frontend/` — React + TypeScript source (18 components, 9 pages, hooks, lib, styles, tests)
- `admin-panel/` — single-file admin dashboard
- `served-builds/` — the actual HTML served to users
- `design-prototype/` — original HTML mockup
- `screenshots/` — 6 reference screenshots

## Product Principles

1. **Trust is mechanical, not policed.** The rating math itself must make gaming unprofitable — verification (attestation) plus deterministic replay is the trust mechanism, not moderation.
2. **Ratings are always derived, never stored as truth.** Every rating must be reproducible from the attested round history; this must survive any future feature work.
3. **Handicap-correct competition.** Features that pit players of different skill levels against each other (fair-match, matchmaking) must account for handicap so competition stays meaningful across skill gaps.
4. **Ready for a real cohort first.** The Shanghai academy trial is the immediate proving ground — onboarding, Chinese-language handling, and PIPL compliance must work for real students now, ahead of the broader public-product ambition it grows toward.

## Accessibility & Inclusion

Registration and core flows must support Chinese-language input/output (round-recap parsing, UI localization as needed) and PIPL consent for the Shanghai trial cohort. No other accessibility standard has been established yet.
