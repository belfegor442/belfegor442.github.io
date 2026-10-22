# TEST STRATEGY — for modular migration + ongoing repair (2026-10-22)

## 1. Existing assets (keep green; they are the migration gate)

| Suite | Runner | Where | Count | What it locks |
|---|---|---|---|---|
| ws-tests | C++ (S:\build\tests\Release\ws-tests.exe, cwd S:\) | server repo | 250 | protocol, storage, relay, roles server-side |
| roles_test.py | Playwright (Chrome channel, headless) | %TEMP%\opencode | 118 | rank ladder, admin panel, ban/mute, 401/403 copy |
| prod_smoke.py | Playwright | %TEMP%\opencode | 5 | boot + login happy path vs prod |
| prod_smoke_pw.py | Playwright | %TEMP%\opencode | 23 | password flows incl. owner admin-reset UI |
| smoke_call_msgbox.py | Playwright | %TEMP%\opencode | 9 | msgBox contract + call dialog wiring |
| smoke_statusbar.py | Playwright | %TEMP%\opencode | 8 | statusbar counts/LED/sync |
| smoke_a11y.py | Playwright + axe-core in-page | %TEMP%\opencode | 2 | logon a11y |
| smoke_themes_a11y.py | Playwright + axe | %TEMP%\opencode | 2 | 3 themes |
| smoke_dialogs_a11y.py | Playwright + axe | %TEMP%\opencode | 5 | sampled dialogs |
| verify_logon_fix.py | Playwright | %TEMP%\opencode | ~15 | D-13/14/15: mojibake + layout matrix |
| probe_reset_owner.py | python requests (ssl unverified) | %TEMP%\opencode | 15 | reset_password API matrix |

Total ≈ 444 checks. **Rule: a migration batch may merge only when this battery
is fully green.**

## 2. Test layout during/after migration (client)

Target tree (only when real tests exist — no empty dirs):
```
docs/app/services/msg.mesh/tests/
  e2e/            # moved/renamed Playwright suites (or kept in %TEMP% until stable)
  smoke/          # quick boot/login/layout
  a11y/           # axe suites
  unit/           # node-based pure-function tests (see 2.1)
```
Interim: keep suites in %TEMP%\opencode (outside repo) until Batch 10; moving
them into the repo is a separate decision (repo currently has no node_modules
/ package.json — adding a test runner is a product decision, see §5).

### 2.1 Unit tests (new, cheap, high value)
Pure modules are unit-testable in bare node (no DOM): format.js, emotes token
conversion, ROLE_RANK math, outbox/drafts reducers, ApiError→friendlyError
mapping, base URL validation (isAllowedBase), envelope normalize (store pure
parts). Add `tests/unit/*.mjs` runnable via `node --test` (node 18+) once the
modules exist (post Batch 2/4/5). No bundler required.

### 2.2 DOM unit tests (later)
msgBox/toast/render-line need a DOM; options (decide at Batch 5):
- happy-dom / jsdom via node --test, or
- keep render covered by Playwright only (cheaper; status quo).
Recommendation: Playwright-only until migration done; revisit.

## 3. What each migration batch must run (minimum)

| Batch | Minimum gate |
|---|---|
| 0 scaffold | check_imports.py + node --check + boot smoke |
| 1 leaf moves | full 444 (nothing should notice) |
| 2 api split | prod_smoke_pw 23 + roles_test 118 + prod_smoke 5 |
| 3 ws move | roles_test + probe_d9_call + manual reconnect |
| 4 store split | full 444 + roles_test twice (flakes) |
| 5 ui split | msgbox 9 + statusbar 8 + a11y suites + themes |
| 6 session/auth extract | prod_smoke_pw 23 + smoke_pw owner flow + verify_logon_fix |
| 7 chat send/history | prod_smoke + msgbox + manual send/retry/outbox |
| 8 adapters | full 444 per sub-commit |
| 9 css | themes a11y + verify_logon_fix layout matrix + eyeball captures |
| 10 shim removal | full 444 + check_imports (no old-path imports) + grep clean |

## 4. Probe conventions (keep)
- Playwright: `channel="chrome"`, headless, `--disable-web-security
  --ignore-certificate-errors`; APP=`http://127.0.0.1:8777/index.html?api=https://127.0.0.1:8080`.
- Login: `page.click("#tileOther")` if `#authUsername` not visible; clear
  localStorage before fresh login (prod_smoke_pw lesson).
- WS probes from page origin 8777, never raw WSS from 8080-served page (CWS kill).
- axe-core via `page.evaluate(AXE_SRC)` (CSP blocks CDN).
- python inline in PS5.1 is forbidden (quoting); write .py files to %TEMP%\opencode.
- Server rebuild gate: schtasks disable keepalive → build → enable; health 200.

## 5. Explicit non-goals (for now)
- No npm/webpack/vite introduction in the migration (vanilla ES modules stay).
- No visual regression pixel CI (captures + manual compare suffice).
- No server C++ unit-test expansion (ws-tests 250 already gate server).
- No mutation testing / coverage quotas.

## 6. Exit criteria for "migration done"
1. All 16 current code files live at their catalog target paths; shims gone.
2. main.js ≤ 300 lines; no file in js/domains or js/adapters > ~400 lines
   (guideline, not hard limit — brief forbids arbitrary limits; flag >600).
3. check_imports.py: no cycles; edges match DEPENDENCY-MATRIX intent.
4. Full 444 battery green; verify_logon_fix ALL PASS.
5. INVENTORY.md updated to final tree; MODULE-CATALOG.md marks TGT=done.
