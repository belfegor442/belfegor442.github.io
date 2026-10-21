# DEFECTS — open + fixed log

## Fixed this session (pre-protocol, verified, committed)
| # | Defect | Fix | Verify |
|---|---|---|---|
| D-3 | call failure showed toast not native dialog | msgBox icon error in startCallUI/acceptCall | smoke_call_msgbox 9/9 |
| D-2 | connect played logon.wav melody | playSound("call") in call.js | same |
| D-1 | stretched scrollbar sprite CSS | pure-gradient Luna CSS in app.css | same |
| D-0 | dead session → blank window (no token reload) | startFromToken guard | roles_test login paths |

## Found by repair rounds (from here on)
| # | Sev | Defect | Root cause | Fix | Verify | Status |
|---|---|---|---|---|---|---|
| D-4 | P2 | main.js insertSticker: sticker fetch had no timeout — dead network hung the send path forever while the toast never appeared | plain fetch(path) despite fetchWithTimeout existing in same module | use fetchWithTimeout(path, 12000) | node --check OK; smoke_call_msgbox 9/9 (app boots + flows with edited main.js) | FIXED |
| D-5 | P2 | Statusbar never showed All/Unread counts and self-banner never showed @handle: renderSidebar writes #allCount/#unreadCount and renderProfile writes #selfHandle/#selfName but those ids did not exist in index.html (silent no-op guarded writes). Legacy f13_web_test.py expected #selfName — that test targets a long-gone layout (.conversation/#chatView/#searchGo) and is obsolete | markup never contained the ids the JS contract writes | index.html: statusbar gains All/Unread spans; self-banner gains #selfHandle line; ui.js drops dead #selfName write (name is shown via #selfBannerName) | new smoke_statusbar.py 8/8 (live counts 1/6 from prod, @handle=@qa1); regression roles_test 118/118, smoke_call_msgbox 9/9, prod_smoke_pw 9/9; node --check OK | FIXED |

## Known out-of-scope (carried)
- Brew map.js/skins.js modified untracked (pre-existing, different game)
- fix_contacts_test.py / theme_function_test need native GUI — cannot run headless
