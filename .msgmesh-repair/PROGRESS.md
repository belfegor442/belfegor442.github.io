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

### Defects
- Found & fixed this session: D-4 (insertSticker unbounded fetch — could hang sticker send on dead network; fixed with existing fetchWithTimeout, verified).
- Found false alarms cleared: 3× JSON.parse (guarded), fetch sites (all have timeouts or are local-asset with catch).

### Modified files
- js/main.js: insertSticker uses fetchWithTimeout (1 line)

### Next rounds (13+)
- R13: login/register/change-password handlers (M06) — read + defect hunt
- R14: file upload path (M14/M15) — size caps, error handling
- R15: route()/hash navigation (M36)
- R16: settings dialogs / server switch flow (M04)
- R17: sound.js/theme.js/emoticons.js leaves (M37)
- R18: notifications.js (M31)
- R19: index.html contract vs JS ids (M02 deeper)
- R20: full regression + commit + push

### Blockers
- None. Server rebuilds blocked only while ws-server running (documented procedure).
