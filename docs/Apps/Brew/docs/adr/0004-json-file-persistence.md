# ADR-0004: JSON file persistence with atomic flush

## Status

Accepted

## Context

Progress (stats, achievements, cosmetics, XP) must survive restarts. The spec
requires zero runtime dependencies, and the deployment target is a small
always-on process where a database server would be overkill.

## Decision

`server/persistence/playerStore.js` keeps players in memory, marks them dirty on
update, and flushes on an interval and on shutdown:

- writes go to `<file>.<pid>.tmp` then `fs.rename` over the target (atomic),
- payload is `{version: 1, players: [...]}`,
- corrupt files are logged and treated as empty instead of crashing boot,
- disabled via `BREW_DB_ENABLED=false` (tests/CI).

Progression helpers (`evaluateAchievements`, `applyProgression`) are pure and run
against the record during flush/close.

## Consequences

- Single-file backups, no external services; a migration path exists via the
  `version` field.
- Loss window equals `flushIntervalMs` (default 4 s) on hard kill — acceptable
  for arcade progress, and `flush()` is called on shutdown.
