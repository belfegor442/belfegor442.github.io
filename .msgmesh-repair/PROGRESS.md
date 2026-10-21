# PROGRESS — msg.mesh repair protocol

## Session 2026-10-21 (protocol start)

### Rounds completed (with evidence)
| R | Objective | Result |
|---|---|---|
| 1 | Real inventory | 16 code files / 9099 LOC measured; INVENTORY.md |
| 2 | M01 syntax | 12/12 js pass node --check (module mode) |
| 3 | M02 references | import graph verified; ws.js aliases resolve in main.js |
| 4 | Baseline suites | 341 checks green (250 ws-tests, 118 roles, 5+9+9 smokes) |
| 5 | XSS audit (M09/M10) | every dynamic innerHTML site uses esc(); emote pipeline order esc→emoteTokens correct; emoteFile whitelist |
| 6 | Timers/resources (M45) | ws/call/store/main: all intervals cleared or app-lifetime+guarded; typingTimers self-expiring |
| 7 | localStorage/JSON (M43) | all JSON.parse guarded try/catch (grep hits were multi-line false positives) |
| 8 | Network layer (M42) | api.js: timeouts on every fetch, failover idempotent-only, session-token binding, 401 hooks |
| 9 | Ingest core (M17/M26) | dedup by message_id, tmp- optimistic replacement, rowid sort, pending→sent/failed |
| 10 | Fix D-4 + verify | insertSticker fetch→fetchWithTimeout(12s); syntax OK; smoke_call_msgbox 9/9 |
| 11 | Send path (M15/M26) | outbox idempotent retry via client_msg_id; session binding on response; retryable gating |
| 12 | Boot (M03) | startFromToken guard, 429 keep-token retry, server watch on netDown |
| 13 | Auth handlers (M06) | register/change/reset pw: validation, 401=current-pw copy, specific 403 copy — clean |
| 14 | Upload path (M14) | session+seq binding, size caps, image compression ladder, xhr abort — clean |
| 15 | Router (M36) | hash routing + auth guard + openChat state cleanup — clean |
| 16-18 | Leaf modules | sound/theme/notifications/frameguard/theme-apply/emoticons — clean (emote whitelist safe) |
| 19 | Markup contract (M02) | 212 JS ids vs 243 HTML ids: 4 orphans found → D-5 |
| 20 | Fix D-5 + verify + regress | statusbar All/Unread + self-banner @handle restored; smoke_statusbar 8/8; roles 118/118; msgbox 9/9; pw 9/9; committed+pushed (2b5f838) |
| 21 | Server suite re-run (M47) | ws-tests 250/250 |
| 22 | Menus + server settings (M36/M04) | all menu items wired to real handlers; HTTPS guard + probe before persist — clean |
| 23 | Upload XHR + drafts (M14/M45) | 60s timeout, session binding, 401→handleSessionLost; drafts debounced+flushed on unload — clean |
| 24 | Groups + shared files + admin (M07/M29) | create confirms server shape; download blob+revoke; admin ladder gated + server copy surfaced; mute minutes validated — clean |
| 25 | Auth/session core (M06/M08) | login tile logic; handleSessionLost full teardown; cross-tab storage sync; startSession token-race guards — clean |
| 26 | markRead + GIF/emote pipeline (M20/M32) | read coalescing + follow-up; GIF seq guards + fetchWithTimeout(15s) + MAX_FILE; emoticon grids use DOM API (no innerHTML) — clean |

### Coverage
- main.js: ~3400/3687 lines read this session (all critical flows: auth, session, send/retry/outbox, upload, admin, menus, settings, GIF/stickers, typing, presence, boot)
- api.js/ws.js/store.js/call.js/ui.js/sound.js/theme.js/notifications.js/emoticons.js/frameguard.js/theme-apply.js: 100% read
- index.html: contract-checked (243 ids vs 212 JS refs; orphans resolved as D-5)
- Remaining unread fragments: main.js 365-525, 1160-1215, 2313-2615, 2675-2780 (continuations of audited patterns; low risk)

### Defects
- D-4 FIXED (commit 29e1b6a): insertSticker unbounded fetch → fetchWithTimeout(12s).
- D-5 FIXED (commit this round): statusbar #allCount/#unreadCount + banner #selfHandle missing from markup; dead #selfName write removed. Legacy f13_web_test.py is obsolete (stale selectors) — not revived.
- False alarms cleared: 3× JSON.parse (guarded), fetch sites (timeout or local+catch).

### Modified files
- js/main.js: insertSticker → fetchWithTimeout (D-4)
- index.html: statusbar All/Unread spans; self-banner #selfHandle line (D-5)
- js/ui.js: removed dead #selfName write (D-5)

### Next rounds (27+)
- R27: read remaining main.js fragments (365-525, 1160-1215, 2313-2615, 2675-2780)
- R28: win98.css/north.css theme parity vs app.css (M37)
- R29: store.js friends/roles/typing tail (M29/M30)
- R30: full final regression (all 6 suites) + audit report so far

### Blockers
- None.
