# MODULES — 50 modules adapted to msg.mesh client (status 2026-10-21)

Legend: [I]=implemented+verified · [P]=partial · [D]=defect found (see DEFECTS.md) · [n/a] · [A]=absent

## A. Integrity / architecture
- M01 Syntactic integrity [I] 12/12 node --check
- M02 References & symbols [I] import graph verified; ws aliases resolve
- M03 Init & bootstrap [I] theme-apply/frameguard before main; verified via smokes
- M04 Configuration [I] apiBase/wsEndpoint resolution, server.local.conf prod
- M05 Architecture/contracts [I] layers leaves→store→ws/ui→main; no cycles found

## B. Security / privacy
- M06 Authentication [I] logon tiles, token, wrong-pw copy (smoke_pw)
- M07 Authorization [I] roles_test 118: rank gating, admin panel, ban/mute
- M08 Session mgmt [I] startFromToken guard (a521de2), signOut clears
- M09 Input validation [P] client trims/limits; server enforces — audit ongoing
- M10 Data protection [I] TLS prod, token in localStorage (documented tradeoff)
- M11 Secrets [I] no creds in client; QA creds only in %TEMP% test scripts
- M12 Dependency security [n/a] zero npm deps; vanilla ES modules
- M13 Privacy [I] blocked lists, role-gated history; audit ongoing

## C. Messaging / transport
- M14 Composition [I] main.js compose path, size caps
- M15 Send [I] api.js POST, ApiError handling
- M16 Receive [I] ws dispatch → store.ingest → ui.renderMessages
- M17 Order/identity [I] rowid monotonic, client dedup by rowid
- M18 Persistence [I] server-side history + localStorage profile
- M19 Conversations [I] conv list, switch, unread
- M20 States [I] pending/sent error path via msgBox on failure
- M21 Connections [I] ws.js open/close/forceReconnect, reconnect loop
- M22 Request optimization [P] periodic refreshConversations — audit redundancy
- M23 Processing optimization [P] full re-render of messages on each ingest — audit
- M24 Storage optimization [P] history fetch windowing — audit
- M25 Render optimization [P] same as M23
- M26 Delivery reliability [P] send errors surfaced; no offline queue — by design?

## D. Users / social
- M27 Registration [I] signup tab, duplicate handling (ws-tests)
- M28 Profiles [I] loadProfile/saveProfile/avatar
- M29 Friends [I] search/add/accept/reject, blocked
- M30 Presence [I] peerOnline, typing
- M31 Notifications [I] notifications.js + in-app toasts
- M32 Search [I] user search with limits
- M33 Calls [I] call.js WebRTC + signaling; msgBox on failure (a521de2)
- M34 Video calls [I] camera toggle, resource release on endCall

## E. UI / state
- M35 State mgmt [I] store.state + emit/on
- M36 Navigation [I] tiles→app, dialogs, menus
- M37 Components [I] msgBox/toast/windows renderers
- M38 Interactions [P] duplicate-submit guards — audit
- M39 UI states [I] loading/empty/error toasts
- M40 Accessibility [P] keyboard works; aria labels sparse — minor

## F. Reliability / ops
- M41 Error handling [P] mixed try/catch — audit consistency
- M42 Network errors [P] friendlyError + failoverBase; timeout audit
- M43 Data integrity [I] normalize guards, esc() XSS on render
- M44 Concurrency [P] single WS + single tab assumption — audit
- M45 Resource mgmt [P] timers/listeners cleanup audit
- M46 Performance [P] baseline: full-repaint path measured via smoke timing
- M47 Tests [I] 5 suites, 341 checks green
- M48 Observability [I] server logs S:\logs; client console only
- M49 Compat/integration [I] contract verified vs prod 401/403/200
- M50 Final audit [P] in progress

Inspected today: all 50. Modified today: none (baseline phase).
