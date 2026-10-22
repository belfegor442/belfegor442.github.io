# FEATURE ROADMAP — capability map + gaps (2026-10-22)

Scope legend: CLIENT = web msg.mesh · SERVER = api_service.cpp · EXTERNAL =
outside msg.mesh subtree (out of brief) · STATUS from R1-R55 verification.

## 1. Capabilities implemented & verified

| # | Capability | CLIENT | SERVER | Status |
|---|---|---|---|---|
| F01 | Login / logout / session restore | api+main | users/login, auth/* | [I] prod_smoke_pw |
| F02 | Register account | main registerDialog | users/register | [I] |
| F03 | Remember username + known-user tile | main+api | — | [I] |
| F04 | Multi-server candidates + failover + health probe | api.js | /health | [I] |
| F05 | Session-lost handling (401 HTTP + WS) | api+ws+main | — | [I] |
| F06 | Change password (self) | main changePwDialog | users/change_password | [I] |
| F07 | Forgot-password notice (no self-service) | main | — | [I] D-15 era |
| F08 | Admin reset password (owner, session-based) | admin panel | users/reset_password | [I] 15/15 probe |
| F09 | Send/receive 1:1 text (WS + poll fallback) | chat+ws | mesh/send, ws relay | [I] |
| F10 | Optimistic send + client_msg_id dedup + retry | main outbox | mesh/send idempotency | [I] |
| F11 | Offline outbox restore (per-account) | main | — | [I] |
| F12 | Drafts (per peer, per account) | main | — | [I] |
| F13 | Message edit / delete / react / pin | main ctx menu | mesh/edit|delete|react|pin | [I] |
| F14 | Replies (envelope-only quote + jump) | main | envelope passthrough | [I] |
| F15 | Read receipts (both directions) | main+ws | mesh/read + read.state | [I] |
| F16 | History windowing + load older | main | mesh/history before_id | [I] |
| F17 | Server-side message search + jump | main searchDialog | mesh/search | [I] |
| F18 | Conversations sidebar (unread, order, groups) | store+ui | mesh/conversations | [I] |
| F19 | Friends: search/add/accept/reject/remove | main | friends/* | [I] roles_test |
| F20 | Block / unblock (+ settings list) | main | friends/block|unblock|blocks | [I] |
| F21 | Presence online/offline + snapshot | ws+main | presence events | [I] |
| F22 | Typing indicator (1:1 + group fan-out) | main+ws | typing frames | [I] |
| F23 | Group create + group chat labels | main | groups/create|list | [I] |
| F24 | Attachments: upload (XHR progress), compress to ≤700KB, download, inline image previews with cache/backoff | main+ui | files/upload|download | [I] |
| F25 | Stickers + native emoticons (:eNNN:) + typed ASCII emotes | main+ui | — | [I] |
| F26 | GIF search (Discord keyless API → upload pipeline) | main | files/* | [I] |
| F27 | Voice/video calls (WebRTC P2P, WS signaling, TURN via /calls/ice) | call.js | calls/ice, call.signal relay | [I] probe_d9 |
| F28 | Call history dialog | main | calls/history | [I] |
| F29 | Roles ladder owner>admin>mod>member (UI mirror) | main admin | chat/roles/* | [I] roles_test 118 |
| F30 | Mute / ban / unmute / unban | admin panel | chat/users/* | [I] |
| F31 | Moderation: recent messages edit/delete | admin mod pane | chat/mod/* | [I] |
| F32 | Audit log | admin audit pane | chat/audit | [I] |
| F33 | Profile edit (display, status, about, avatar, photo, banner) + server sync + legacy migration | profile dialog | users/update, whoami.profile | [I] |
| F34 | Themes XP / Win98 / North + icon mapper | theme.js + 3 CSS | — | [I] themes a11y |
| F35 | XP sounds (startup/logon/msg/click/menu/error/call ring) | sound.js | — | [I] __sfxLog |
| F36 | Desktop notifications (hidden tab, cooldown) | notifications.js | — | [I] |
| F37 | msgBox modal + toast + ctx menu | ui/main | — | [I] smoke 9+ |
| F38 | Settings: server switch (validated HTTPS), timestamps toggle, sign out | main | — | [I] |
| F39 | Mobile layout (650px col switch, keyboard viewport) | ui+css | — | [I] |
| F40 | Statusbar counts + connection LED + sync state | ui | — | [I] smoke_statusbar |
| F41 | Admin Tools menu hidden for members | main roles handler | — | [I] smoke_pw |
| F42 | Clickjacking frameguard + CSP (script-src self) | frameguard+meta | http CSP? | [I] client; server headers TBD |
| F43 | Multi-tab session sync (storage event) | api+main | — | [I] |
| F44 | Server-unreachable self-heal watch (login screen) | main serverWatch | — | [I] |

## 2. Gaps / partial / deferred (candidates for future roadmap)

| # | Gap | Where | Notes |
|---|---|---|---|
| G01 | No offline compose queue beyond outbox retry (airplane mode send fails immediately) | chat | outbox restores undelivered; no local-first queue while offline |
| G02 | Full transcript re-render per event (no virtualization) | ui renderMessages | OK to ~thousands; long-lived groups will feel it; M23/M25 |
| G03 | History fetch is 200-row windows, no cursor UI | chat | loadOlder exists; no jump-to-date |
| G04 | Reactions limited to 6 fixed emoji | ctx menu | server accepts any emoji string |
| G05 | No message forwarding / quote-all | — | envelope has reply only |
| G06 | Group admin (rename, kick, leave) partial | chat/groups/manage API exists server-side; UI limited | chatGroupManage in api.js; UI thin |
| G07 | No end-to-end encryption (server sees plaintext) | product | mesh server trust model; future roadmap item |
| G08 | Server CSP/frame headers not audited (client meta CSP only) | server http_server | verify X-Frame-Options / CSP on static serve |
| G09 | No automated UI unit tests (only Playwright e2e smokes + C++ ws-tests) | tests | migration adds tests/ scaffold |
| G10 | aria labels sparse; axe clean on sampled dialogs only; 7 dialogs pending axe | a11y | R55 leftover |
| G11 | Sound autoplay best-effort (browser policy) | sound | by design |
| G12 | GIF hotlist depends on Discord endpoint availability | external | graceful toast on failure |
| G13 | No i18n (English strings hardcoded) | everywhere | |
| G14 | admin_auth() dead code server-side | server | noted, not defect |
| G15 | testuser1 password not rotated | ops | pending |
| G16 | Brew map.js/skins.js modified unstaged (outside msg.mesh) | repo hygiene | user decision pending |

## 3. Server endpoints with no/minimal client UI (opportunity)

- `chat/groups/manage` (kick/leave/rename?) — wire into group details
- `users/search` pagination/limits — UI uses bare query
- `calls/ice` refreshed only opportunistically — could refresh on network change

## 4. Prioritized next features (proposal, not committed)
1. P1: axe a11y pass on remaining 7 dialogs (cheap, R55 leftover)
2. P1: rotate testuser1 password (ops)
3. P2: group management UI (uses existing server API)
4. P2: message virtualization if profiling shows jank (after migration)
5. P3: reaction picker expansion (server already permissive)
6. P3: e2e encryption study (large; product decision)
