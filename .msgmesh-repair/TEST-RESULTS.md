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
| 10-21 | Server audit close (R36-40) | 0 defects | http_server/database/mutation/moderation/admin/apps/ops sweep all clean; no rebuild needed (no code change) |
| 10-21 | smoke_a11y (new, R41) | 2/2 | logon axe critical (D-7) + chat contrast serious (D-8) found |
| 10-21 | smoke_a11y post D-7 | 2/2 | logon 0 violations |
| 10-21 | smoke_themes_a11y (new, R43) pre-fix | 0/2 | win98 4 nodes + north 6 nodes contrast (D-8) |
| 10-21 | smoke_a11y + themes post D-8 | 4/4 | logon+chat 0/0; win98+north 0/0 |
| 10-21 | regression post D-7/D-8 | 17/17 | statusbar 8/8 + call msgbox 9/9 |
| 10-21 | probe_d9_call (new, R45) | 8/8 | attacker end 403 + row untouched + no frame; ghost id 403; legit end works |
| 10-21 | FULL battery (R46, post D-9) | 403/403 | ws 250 + roles 118 + prod 5 + pw 9 + msgbox 9 + statusbar 8 + a11y 2 + themes 2 |
| 10-21 | FULL battery (R48, post D-10) | 399/399 | ws 250 + roles 118 + prod 5 + pw 9 + msgbox 9 + statusbar 8 + d9 probe 8 |
| 10-21 | smoke_dialogs_a11y (new, R51) pre-fix | 2/5 | D-11 (4 unlabeled inputs) + D-12 (.list-empty 2.95:1) |
| 10-21 | R51 post-fix | 26/26 | dialogs 5/5 + a11y 2/2 + themes 2/2 + statusbar 8/8 + msgbox 9/9 |
| 10-22 | verify_logon_fix (new, R52-54) | ALL PASS | D-13 source+notice; D-14 matrix 5 vp x 3 themes x 2 selections (overlap 0); D-15 card center err 0.0; 958x360 scroll OK; qa1 login → statusbar |
| 10-22 | full client battery post D-13/D-14/D-15 | 31/31 | a11y 2/2 + themes 2/2 + dialogs 5/5 + statusbar 8/8 + msgbox 9/9 + prod 5/5 |
| 10-22 | probe_reset_owner (new, R55) | 15/15 | member/no-cred/junk → 403; shutdown_token → 200; owner session → 200; audit actors; roles restored |
| 10-22 | prod_smoke_pw (rewritten R55) | 23/23 | new Admin Panel reset flow end-to-end; legacy dialog gone; member gate |
| 10-22 | FULL battery post-integration (server 1f95bca) | 444/444 | ws 250 + roles 118 + prod 5 + pw 23 + msgbox 9 + statusbar 8 + a11y 2 + themes 2 + dialogs 5 |
