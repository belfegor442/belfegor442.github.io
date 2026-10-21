# BASELINE — 2026-10-21 (pre-repair reference state)

## Code under test
- Client: docs/app/services/msg.mesh @ a521de2 (+255 files, 16 code files, 9099 LOC)
- Server prod: S:\build\server\Release\ws-server.exe (0dca0a1 + migration 021), port 8080 TLS
- e2e server: S:\build\server\Release\ws-server-e2e.exe (byte-identical copy)

## Executable suites (all green at baseline)
| Suite | Result | What it covers |
|---|---|---|
| ws-tests.exe (S:\, C++) | 250/250 | server: auth, messages, roles, bans, mutes, api |
| roles_test.py (e2e 18336) | 118/118 | app_role lifecycle, admin panel UI, banned badge, re-login |
| prod_smoke.py | 5/5 | prod health, TLS, static 8777, Pages live |
| prod_smoke_pw.py | 9/9 | change_password/reset_password UI lifecycle, 401/403 endpoints |
| smoke_call_msgbox.py | 9/9 | call failure -> native msgBox, call.wav sound, Luna scrollbar CSS |

## Metrics baseline (client)
- Syntax: 12/12 js modules pass node --check (module mode)
- LOC: 9099; largest module main.js 3456 lines (38% of code)
- Defects open at baseline: 0 known in tracked code (fixes a521de2 deployed and verified on Pages)
- Known out-of-scope: Brew map.js/skins.js modified untracked; fix_contacts/theme_function tests (native GUI)

## Error-rate metric note (Regla 14)
Baseline defect count in tracked client code = 0 reproducible failures across the 5 suites.
A % reduction cannot be computed from 0; new defects found during repair rounds will be
tracked in DEFECTS.md with before/after counts of suite failures instead.
