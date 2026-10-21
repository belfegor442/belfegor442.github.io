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
