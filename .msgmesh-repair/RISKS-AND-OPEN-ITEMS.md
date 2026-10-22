# RISKS & OPEN ITEMS — consolidated 2026-10-22 (post-R55)

## 1. Defects history (all fixed & verified; constraints to preserve)

| ID | Sev | Summary | Fix landed | Constraint for migration |
|---|---|---|---|---|
| D-0..D-12 | mixed | (see DEFECTS.md R1-R54) auth/session/call/render fixes | earlier commits | keep session-guard pattern; keep msgBox contract |
| D-13 | P2 | mojibake: 43 strings double-encoded UTF-8→CP1252→UTF-8 in main.js | `13491bf` | write UTF-8 no-BOM; never let PS5.1 Get-Content round-trip source; verify U+2014/U+2026 after main/ui edits |
| D-14 | P1 | logon fields absolute-positioned → overlap 650-1400px; `safe center` scroll fix | `13491bf` | preserve `.logon-fields` static flow + `.logon-root` align-items:safe center; verify layout matrix 660/800/958/1280/1916 |
| D-15 | P2 | north logon card pinned left | `13491bf` | keep `margin:auto` centering + short-viewport padding |

No open defects. No fake fixes. All 444 checks green at HEAD `584aa3c`.

## 2. Migration risks (modular refactor)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Double module instantiation (old path + new path both loaded) | M | H (two stores/tokens) | strangler shims re-export same bindings; check_imports.py flags dual-path; Batch 10 grep |
| Import cycle after split | M | H (boot crash) | check_imports.py in Batch 0; layered rule ADR-007 |
| localStorage key drift | L | H (silent data loss) | keys frozen (CONTRACTS §4); unit test on key registry |
| Copy string drift breaks smokes | M | M (test red, not user bug) | copy frozen; smokes assert exact strings |
| CSS cascade break (theme override order) | M | M (visual) | load order base→xp→win98→north unchanged; screenshot matrix |
| main.js extract misses a hidden listener | M | M (dead button) | full battery per adapter sub-commit; manual click-through toolbar/menus |
| CRLF/encoding regression (D-13 class) | L | M | python utf-8 writers; verify_logon_fix source check |
| Scope creep (behavior fixes mixed into refactor) | M | M (unreviewable diffs) | ground rule: no behavior changes in migration commits |
| Store split (Batch 4) regresses unread/presence | M | H | roles_test ×2 + statusbar + manual unread checks |
| Probe scripts reference old internals | L | L | probes use public DOM ids (frozen) |

## 3. Product/ops open items (not defects)

| Item | Owner | Status |
|---|---|---|
| Brew `docs/Apps/Brew/src/{map.js,skins.js}` modified unstaged | user | pending decision (commit/revert/leave) |
| testuser1 (u2) password not rotated | ops | pending |
| Duplicate case-path git entries (docs/apps vs docs/Apps) | repo | workaround documented (worktree cherry-pick; never stash); long-term cleanup = user call |
| axe a11y on 7 remaining dialogs | repair | pending (R55 leftover, P1) |
| M50 informe final | repair | pending after migration or as closure report |
| Server static CSP/X-Frame-Options headers (G08) | server | not audited |
| admin_auth() dead code (server) | server | known, non-defect |

## 4. Operational constraints (from prior rounds — still true)

- Server rebuild: disable `\ws-keepalive` → stop ws-server → `cmake --build
  S:\build --config Release --target ws-server` → enable + `/run`; health 200.
- DB path `S:\build\server\Release\data\weirdstuff.sqlite`.
- Never `git add -A` in site-mobile (Brew noise).
- PS 5.1: no `&&`, no heredoc, no inline python -c with complex quoting;
  grep is case-insensitive (Select-String).
- Playwright WSS raw from 8080-served page kills Chrome → probe WS from 8777.
- `Get-Content` mojibake ≠ disk corruption (verify with python).
- push verify: `git rev-list --left-right --count main...origin/main` = 0/0.
- Owner QA u93 password unknown; qa1/qa2 creds in %TEMP% scripts only.

## 5. Recommended execution order (post-approval)

1. Batch 0 (checker) → 1 (leaf moves) → 2 (api) → 3 (ws) — low risk, immediate structure win.
2. Batch 4 (store) — schedule with full battery + double roles_test.
3. Batches 5-8 (ui + main.js shedding) — one adapter per commit.
4. Batch 9 (css) with screenshot matrix.
5. Batch 10 (shims out, inventory final, M50 informe).
6. Interleave P1 ops: axe 7 dialogs + testuser1 rotation (independent, can land anytime).
