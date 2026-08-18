# Backups

Point-in-time snapshots preserved before restructuring the project, not
part of the running app. Safe to ignore unless you specifically need old
data back.

## deploy-form-2026-08-17.db

Consistent backup of `deploy/src/data/form.db` as it stood before the
`deploy/` folder was restructured to stop duplicating source code
(2026-08-18). Contains real usage from early development: your own account
(`michaelz.zhanghan@gmail.com`), 10 seeded pro benchmark players, ~18 other
test accounts, and 25 logged rounds. This is **not** the database used by
the current `server/` package — that one (`server/src/data/form.db`) is the
clean slate meant for the real Shanghai academy trial.

## deploy-dusk-2026-08-04.db

Same provenance, backup of `deploy/src/data/dusk.db`.
