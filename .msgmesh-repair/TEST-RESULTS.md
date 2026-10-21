# TEST-RESULTS — 2026-10-21 baseline + repair runs

## Baseline (pre-protocol, all green)
- ws-tests.exe: 250/250
- roles_test.py: 118/118
- prod_smoke.py: 5/5
- prod_smoke_pw.py: 9/9
- smoke_call_msgbox.py: 9/9
Total automated checks: 341 pass / 0 fail

## Repair-round runs (append below)
| Date | Suite | Result | Notes |
|---|---|---|---|
| 10-21 | roles_test | 118/118 | baseline re-run |
| 10-21 | prod_smoke_pw | 9/9 | baseline re-run |
| 10-21 | smoke_call_msgbox | 9/9 | baseline re-run |
| 10-21 | smoke_call_msgbox | 9/9 | post-D-4 fix (edited main.js) |
| 10-21 | smoke_statusbar (new, D-5) | 8/8 | @handle + All/Unread live counts |
| 10-21 | smoke_call_msgbox | 9/9 | post-D-5 regression |
| 10-21 | prod_smoke_pw | 9/9 | post-D-5 regression |
| 10-21 | roles_test | 118/118 | post-D-5 regression |
| 10-21 | ws-tests | 250/250 | R21 |
| 10-21 | FULL battery (R30) | 349/349 | ws 250 + roles 118 + prod 5 + pw 9 + msgbox 9 + statusbar 8 |
| 10-21 | perf_baseline | PASS | send p50 12.7ms, history p50 15.7ms, login p50 128.5ms (PBKDF2) |
| 10-21 | probe_d6 (pre-fix) | LEAK | testuser1 read 200 alien rows of 634 total |
| 10-21 | probe_d6 (post-fix) | 0/0 OK | testuser1 history count=0, alien=0 |
| 10-21 | FULL battery (R35, post D-6) | 399/399 | ws 250 + roles 118 + prod 5 + pw 9 + msgbox 9 + statusbar 8 |
