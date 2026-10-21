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
| 27 | main.js remaining fragments (M03/M08/M19) | syncProfileFromServer account-scoped owner check + one-time legacy migration; logout full teardown incl PII/outbox/drafts; openAttachment forced-download (blob origin security); ensurePeerHistory + loadOlder session/scroll guards; reconnect burst max 20 idempotent retries — clean |
| 28 | Theme parity + assets (M37/M12) | all 3 CSS load as override layers (data-theme); win98/north missing admin selectors = intentional fallback to app.css; 48/48 CSS url() assets + 55/55 HTML assets + manifest icon exist (first script had a ../ path bug — retracted false alarm) — clean |
| 29 | store.js tail (M29/M30) | typing TTL lazy expiry; primeUsers batched cache; friends/requests status filters; blocks/groups/roles offline fallbacks; ROLE_RANK mirrors server — clean; store.js now 100% read (619/619) |
| 30 | Full final regression (M47/M50) | all 6 suites green: ws-tests 250/250, roles_test 118/118, prod_smoke 5/5, prod_smoke_pw 9/9, smoke_call_msgbox 9/9, smoke_statusbar 8/8 = 349 checks, 0 failures |
| 31 | Perf baseline vs prod (M50) | send p50=12.7ms, history p50=15.7ms, login p50=128.5ms (PBKDF2 cost, deliberate), health/whoami/friends/roles all p50~15ms — PASS |
| 32 | Server: rate_limiter.cpp + password.cpp | sliding-window limiter with carry + clock-backwards guard + mutex; PBKDF2-HMAC-SHA256, const-time compare, iterations bounds, legacy sha256 upgrade path — clean |
| 33 | Server: login + identify_caller + session tokens | parameterized SQL, dummy-verify anti-timing, throttle, ban fence, const-time shutdown token, expiry inside session query, role ladder immutable owner — clean |
| 34 | Server: mesh_send + files + history authz | dual auth (node/session), mute/ban fences, block/group checks, idempotency; files: blobs in DB (no path traversal possible), per-user grants, 1MB cap; **history: D-6 cross-user leak found** (see DEFECTS) |
| 35 | D-6 fix + full server rebuild + verify | api_service.cpp tenant clause gated to personal tenants only; probe 200 alien rows → 0/0; battery 399/399 green; server rebuilt (ws-server target), restarted PID 100168, keepalive re-enabled; server repo commit 22a1a84 pushed 0/0 |
| 36 | Server: http_server.cpp (100%) | CORS allowlist reflection (no *), XFF rightmost anti-spoof key for loopback proxy, OPTIONS excluded from rate limit, hardening headers (nosniff/no-referrer/frame-deny/CSP), payload_max_length, WS token from param/headers, status range 100-599 guard — clean |
| 37 | Server: database.cpp (100%) | Statement/Transaction RAII with recursive mutex until finalize, NUL checks, SQLITE_TRANSIENT binds, FULLMUTEX+busy_timeout+WAL+FK, migration sequence-gap/filename verification, table_row_count identifier validation, import quote-doubling + bound values — clean |
| 38 | Server: message mutation + moderation | begin_mesh_control participant/group/membership fence + mod bypass only with delete_any; edit/delete ladder (owner immutable, strictly below, audit); react transaction RMW toggle; pin participant-shared; chat_role_set/mute/ban all rank-gated + chat_target_allowed + audit; ban drops sessions — clean |
| 39 | Server: register/users_update/admin/apps | register config-gated + length caps + txn uniqueness + personal tenant; users_update field whitelist + sanitize + blob-safe audit; admin db_list whitelist+quote_ident+binds; db_export redacts secrets unless raw; db_import rejects redacted + schema check; db_switch weakly_canonical root fence; apps_launch admin-only, config-path only, name/args validators, Windows arg quoting — clean |
| 40 | Server: pattern sweep + ops_service sample | whole-src grep: no sprintf/strcpy/system/popen; only CreateProcessW is the audited apps_launch; ops_service handle_list: all SQL fragments server-spec constants, all user values BoundValue binds, non-admin owner scoping — clean. Server audit closed: 0 new defects in rounds 36-40 |

### Coverage
- main.js: ~3620/3687 lines read (98%+; every critical flow: auth, session, send/retry/outbox, upload, admin, menus, settings, GIF/stickers, typing, presence, boot, profile migration, history paging, reconnect burst)
- api.js/ws.js/store.js/call.js/ui.js/sound.js/theme.js/notifications.js/emoticons.js/frameguard.js/theme-apply.js: 100% read (store.js closed this round: 619/619)
- index.html: contract-checked (243 ids vs 212 JS refs; orphans resolved as D-5); 55/55 assets exist
- CSS: all 3 themes audited as override layers; 48/48 url() assets exist
- No defects found in rounds 27-30 (only one retracted false alarm: CSS asset script path bug)

### Defects
- D-4 FIXED (commit 29e1b6a): insertSticker unbounded fetch → fetchWithTimeout(12s).
- D-5 FIXED (commit this round): statusbar #allCount/#unreadCount + banner #selfHandle missing from markup; dead #selfName write removed. Legacy f13_web_test.py is obsolete (stale selectors) — not revived.
- False alarms cleared: 3× JSON.parse (guarded), fetch sites (timeout or local+catch).

### Modified files
- js/main.js: insertSticker → fetchWithTimeout (D-4)
- index.html: statusbar All/Unread spans; self-banner #selfHandle line (D-5)
- js/ui.js: removed dead #selfName write (D-5)

### Next rounds (31+)
- R31+: deepen areas with zero findings so far only where new evidence appears; optional: server-side api_service.cpp audit rounds (separate repo), perf timing baselines, axe accessibility pass
- M50 final audit report when protocol closes (100 rounds or user stop)

### Blockers
- None.

## R41-43 — axe accessibility + contrast (2026-10-21)

- R41: axe-core 4.10.2 pass over logon + chat (default theme). CDN injection blocked by page CSP `script-src 'self'` (correct hardening) → smoke loads axe.min.js locally and injects via page.evaluate (Runtime.evaluate not subject to page CSP). Found D-7 (logon inputs unlabeled, axe critical).
- R42: D-7 fixed (aria-labels, no visual change). Then axe contrast pass found D-8 in default theme: #selfHandle 3.7:1 + .contact-time 2.95:1. Root cause: --xp-dim and gray tokens fail 4.5:1 on --xp-face (#d4dbe4) — 17 usages affected though axe only flags visible ones.
- R43: theme pass (win98 + north) via smoke_themes_a11y.py found D-8 deeper: win98 self-banner green 4.0:1 + list grays 3.94:1; north uses light-bg slate #64748b on dark surfaces (6 nodes, 2.35-3.95:1). Fixed across app.css/win98.css/north.css (15 text tokens → #94a3b8 in north; hover border left alone — borders exempt from WCAG text contrast).

### Defects
- D-7 FIXED: aria-label on #authUsername/#authPassword.
- D-8 FIXED: contrast tokens across all 3 themes (app.css --xp-dim #595959, .contact-time #6e6e6e, banner green #0f5a22; win98 grays #6e6e6e; north slate tokens #94a3b8).

### Modified files
- index.html: aria-labels (D-7)
- css/app.css: --xp-dim, .contact-time, .self-banner-body strong colors (D-8)
- css/win98.css: list grays (D-8)
- css/north.css: 15 text tokens (D-8)

### New test assets
- smoke_a11y.py: axe WCAG A/AA on logon + chat (2 assertions)
- smoke_themes_a11y.py: axe color-contrast on win98 + north (2 assertions)
- probe_contrast.py: violation detail dumper (fg/bg/ratio/target)

### Next rounds (44+)
- Continue handler sweep (mesh poll done — clean: node auth, tx claim, TTL sweep, clamped LIMIT); remaining: signal/call_signal, handshake/nodes, activate/keys, group_manage/chat_audit, tenants
- Optional: axe pass over dialogs (profile/settings/new-chat) when opened

### Blockers
- None.

## R44-46 — call signaling audit + D-9 (2026-10-21)

- R44: handle_mesh_signal read clean (type whitelist offer/answer/ice/candidate/bye, size caps, receiver-exists check, parameterized INSERT, 10-min expiry). handle_call_signal audit found D-9: call_id is client-chosen and only friendship(from,target) gated frames — call_log UPDATEs matched on call_id alone, so any friend of a participant could hang up/corrupt third-party calls (browser keys call state by call_id).
- R45: D-9 fixed (server commit 0c4bfe9): participant binding on non-invite frames (row must exist with participants exactly {from,to}), invite upsert guards ON CONFLICT, accept/decline/end UPDATEs bind both participants. Server rebuilt (PID 117168) + keepalive re-enabled.
- R46: probe_d9_call.py (3-browser WS triangle, testuser1↔qa1 call, attacker qa2): attacker end → 403, row untouched, no frame delivered; ghost id → 403; legit end works. 8/8. Full battery green: ws 250, roles 118, prod 5, pw 9, msgbox 9, statusbar 8, a11y 2, themes 2 (411 checks).
- Notes: raw WSS from a page served by the API origin (https://127.0.0.1:8080) is closed by Chrome at construction; probes must run from the app page origin (http://127.0.0.1:8777). friendship request/accept responses nest payload under "request".

### Defects
- D-9 FIXED (server 0c4bfe9): call signaling bound to call_log participants.

### Next rounds (47+)
- Continue handler sweep: handshake/nodes (2479+), activate/keys (3021+), friends REST (4608+), groups/calls (5352+), group_manage/chat_audit (6340+), update (6546+), mesh_read (6962+), tenants (8881+)
- Optional: axe pass over dialogs when opened; call_log cleanup of probe rows

### Blockers
- None.

## R47-48 — keys/activate/admin-auth sweep + D-10 (2026-10-21)

- R47: handle_mesh_handshake + handle_nodes clean (auth required, 90s stale sweep, discovery directory is public-by-design for native nodes). handle_auth_reset_password, handle_auth_activate, handle_auth_generate_keys, handle_auth_validate_key all clean (activate: transaction + conditional key claim + changes()==1; validate: identical body for invalid/used keys, anti-enumeration, throttled per key_code).
- R48: admin helpers audit — whitelist+quote_ident, typed binds, redaction suite (exact set + suffix heuristics, import rejects redacted dumps) all sound. Found D-10: admin_auth() used operator!= for the admin token (all other secret compares use ws::const_time_eq). Helper is dead code (handlers use authorize_admin) but hardened anyway (server 4aaf486). Full battery green post-rebuild.

### Defects
- D-10 FIXED (server 4aaf486): const-time compare in admin_auth (hardening, helper unreached).

### Next rounds (49+)
- Handler sweep continues: friends REST (4608+), groups/calls (5352+), group_manage/chat_audit (6340+), update (6546+), mesh_read (6962+), tenants (8881+)

### Blockers
- None.

## R49-50 — friends/groups/roles sweep, server map CLOSED (2026-10-21)

- R49: friends REST fully read — request/accept/reject/lists/remove/block/unblock all clean (session identity binding with claimed-id mismatch → 403, recipient checks, conditional UPDATEs, block kills friendship+pending both ways). typing: muted/banned dropped, group-membership + block fences. helpers (users_blocked/is_group_member/group_members/friend_participants/publish_presence) parameterized.
- R50: groups/calls/roles — group_create (name/size/member caps, per-member exists+block fences, rollback on partial insert), group_list (membership JOIN), calls_history (me-scoped caller/callee), calls_ice (session-gated config echo), chat role ladder (owner unassignable, chat_target_allowed with owner_immutable, admin grants ≤ moderator, changes()==1), mute (int minutes → datetime modifier, no user string in SQL), group_manage (creator OR manage_any; ladder on remove_member), chat_audit (admin+, limit clamped). Server handler map is now fully swept (R21-R50): D-6, D-9, D-10 found; nothing else.
- Design observations (NOT defects — behavior is test-encoded): (1) group_create accepts non-friend members (roles_test:291 and test_api_hardening.cpp both assert 201 without prior friendship; product policy is "strangers can contact you, blocks are the fence", same as DMs); (2) native-node identity (resolve_friend_identity==0) may act on legacy friend endpoints without ownership checks — node tokens are operator-issued high-trust credentials; (3) group with all members removed lingers as an orphan row (cosmetic).

### Defects
- None this round.

### Next rounds (51+)
- Client dialog axe pass (profile/settings/new-chat/group dialogs opened via UI, axe WCAG A/AA + contrast across 3 themes)
- Optional: mesh_read (6962+) and tenants (8881+) spot re-read; call_log cleanup of probe rows

### Blockers
- None.
