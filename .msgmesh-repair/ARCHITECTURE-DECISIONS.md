# ARCHITECTURE DECISIONS — msg.mesh modular migration (2026-10-22)

ADR-style. Status: PROPOSED (awaiting user approval before execution).

## ADR-001 Vanilla ES modules, no bundler
- Context: current tree is native ES modules + 2 classic scripts; CSP
  script-src 'self'; zero npm deps.
- Decision: keep zero-build. Migration only re-arranges files/imports.
- Consequences: no tree-shaking/code-split (fine at ~10k LOC); unit tests via
  `node --test` on pure modules; Playwright for e2e. Rejects bundler until a
  measured need (payload size, perf) appears.

## ADR-002 Taxonomy is base-mandated; adapted where reality differs
- Context: user taxonomy bootstrap/core/domains/infrastructure/shared/adapters
  + css/tests/docs. Brief: no empty files, no arbitrary file/line limits.
- Decision: adopt taxonomy; only create a path when a real unit lands
  (Batch-driven). `ui.js` is NOT a single "views" module — it splits along
  domain lines (chat sidebar vs chat transcript vs contacts vs profile)
  because those have different change cadence and dependencies.
- File-size guideline: prefer <400 LOC; main.js is the known outlier until
  Batch 8. No forced splits that shred cohesive logic.

## ADR-003 Strangler re-export shims during transition
- Decision: old paths (`js/api.js`, …) become `export * from "newpath"` until
  Batch 10 deletes them. Allows incremental importer flips and cheap reverts.
- Consequences: temporary duplicate module identities are possible (two
  URLs for same code) — acceptable because state is single-instance via
  store.js being imported once; check_imports.py must flag double-instantiation
  risks (same logical module reachable via two paths).

## ADR-004 Frozen wire + copy contracts (see CONTRACTS.md)
- Decision: migration changes file layout only. Endpoint payloads, WS frames,
  localStorage keys, DOM ids, and user-visible copy strings are frozen.
- Rationale: 444 automated checks + user-visible XP/Win98/North behavior are
  the safety net; drift would invalidate them.

## ADR-005 CSS: base + theme override layers
- Decision: app.css splits into base (tokens/layout/components) + xp skin;
  win98/north stay override layers loaded after, keyed on [data-theme].
- Rationale: matches current cascade (win98.css/north.css already override
  app.css); avoids rewriting selectors; theme switch remains attribute-only.

## ADR-006 Session/state hub stays singleton
- Decision: `state` remains one mutable singleton with on/emit pub/sub (moved
  to js/core/state.js), not rewritten to Redux/signals.
- Rationale: every module + probe assumes `state`; rewrite risk >> benefit at
  this size. Can revisit post-migration if debugging pain appears.

## ADR-007 Adapters own DOM wiring; domains own flows; infra owns transport
- Rule of thumb adopted for Batch 6-8:
  - If it calls fetch/WS/localStorage → infrastructure (or domain via endpoints).
  - If it orchestrates multiple API calls + state → domain.
  - If it only attaches listeners to known ids and calls domain/ui → adapter.
  - If it is pure (no DOM, no network) → shared.
- Prevents main.js from regrowing: new features land in a domain/adapter, not
  in main.js.

## ADR-008 Testing lives outside repo until migration completes
- Decision: keep Playwright/python suites in %TEMP%\opencode during Batches
  0-9; deciding to vendor them (docs/app/services/msg.mesh/tests/) is Batch 10
  work with its own commit (adds package.json only if node --test unit files
  need a home — node --test works without package.json).
- Rationale: avoids mixing test-infra changes into refactor diffs.

## ADR-009 Server untouched
- Decision: client-only migration. api_service.cpp / http_server.cpp stay as
 -is; contract freezes are enforced client-side.
- Rationale: blast-radius control; server has its own ws-tests gate.

## ADR-010 Profile caching model retained
- Decision: server owns profile truth; localStorage is a cache scoped by
  msg.mesh.profileOwner with one-shot legacy migration flag — unchanged.
- Alternatives considered: IndexedDB for photos (larger payloads already capped
  at data-URL 10MB check); not worth it until photo feature grows.

## ADR-011 Icon/theme mapping stays data-driven in infrastructure/theme
- Decision: W98 icon map + dataset.icon capture + MutationObserver sweep stay
  together (one concern). Logon screen exempted (auth icons stay XP art) —
  this exemption is intentional product behavior, documented in theme.js.

## ADR-012 Failover/replay policy unchanged
- Decision: non-idempotent POSTs never auto-replay on failover; idempotent
  ones single-retry. Outbox restore uses original client_msg_id.
- Rationale: server dedupes by client_msg_id; double-execution of
  friend-request/profile-update would be user-visible corruption.

## Open decisions (need user input before/while executing)
1. Brew unstaged files (docs/Apps/Brew/src/map.js, skins.js): commit, revert,
   or leave dirty? (Blocks clean pulls only; not blocking msg.mesh work.)
2. Vendor Playwright suites into repo (Batch 10) or keep in %TEMP%?
3. Any appetite for e2e encryption (G07) on the roadmap, or explicitly out?
4. Should server static serve add X-Frame-Options/CSP headers (G08) — server
   change, separate approval.
