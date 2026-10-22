# INVENTORY — msg.mesh (re-verified 2026-10-22, R55)

Source of truth: real files under `docs/app/services/msg.mesh/` in the site-mobile
working tree (branch `main`, HEAD `584aa3c`). Supersedes the 2026-10-21 baseline
(main.js grew 3456→3700 with D-13/14/15 and the password-reset rework).

## Counts (measured, not assumed)
- Code files: **16** (12 .js, 3 .css, 1 .html) + `manifest.webmanifest`, **9683 lines**
- Assets: icons/sprites, emoticons (001-106), stickers, sounds (9 wav), fonts, gifs
- Total tracked by git in the msg.mesh subtree.

## Code files (lines = current disk)

| File | Lines | Role |
|---|---|---|
| js/main.js | 3700 | Composition root: auth/session/router, send/outbox/drafts, uploads, dialogs (new chat, search, profile, settings, group, change/reset pw, call UI, admin panel), menu bar, presence/typing wiring, boot |
| js/ui.js | 879 | Pure DOM rendering: sidebar/contacts/chat/details, msgBox, toast, msg lines, attachments image cache, emotes |
| js/store.js | 619 | Shared mutable state + pub/sub (`on`/`emit`), ingest/normalize, friends/groups/roles/typing helpers |
| js/call.js | 458 | WebRTC voice/video state machine + WS signaling (invite/accept/decline/offer/answer/candidate/end) |
| js/api.js | 439 | HTTP client: base resolution/failover, token storage, ApiError, friendlyError, endpoint map |
| js/ws.js | 338 | WebSocket connect/auth/dispatch, heartbeat/watchdog/poll, reconnect+failover |
| js/emoticons.js | 116 | `EMOTICONS` file table + `emoteFile(id)` |
| js/theme.js | 114 | Theme set/persist + XP→Win98 icon mapper, MutationObserver sweep |
| js/sound.js | 73 | XP wav player + ring loop |
| js/notifications.js | 35 | Notification API permission + notifyIncoming cooldown |
| js/theme-apply.js | 13 | Early classic script: set `data-theme` pre-paint (CSP-safe) |
| js/frameguard.js | 7 | Clickjacking bust-out (classic script) |
| css/app.css | 1125 | XP Luna base theme + layout + dialogs |
| css/win98.css | 706 | Windows 98 overrides |
| css/north.css | 536 | North Assembly dark overrides |
| index.html | 525 | Single-page markup: logon, app frame, 14 dialogs, toasts, ctx menu |

## Dependency graph (verified via import statements)
```
api.js (leaf)
  ↑ store.js
      ↑ ws.js ↔ api.js
      ↑ call.js ↔ ws.js, api.js, sound.js
      ↑ ui.js ↔ api.js, sound.js, emoticons.js
          ↑ main.js (imports all + notifications, theme)
theme.js · sound.js · notifications.js · emoticons.js · theme-apply.js · frameguard.js (leaves)
```
Layers: leaves → store → ws/ui/call → main (composition root). No import cycles.

## Entry points (index.html)
- Classic scripts (before paint): `frameguard.js`, `theme-apply.js`
- Module: `js/main.js` (imports everything else)

## Server counterpart (separate repo, S:\)
- `server/src/api_service.cpp` (~9.2k lines) serves `/api/v1/*` used by api.js
- `http_server.cpp` serves static site + injects `X-Session-Token` fallback header
- Health: `GET /health` → `{status:"ok"}`; DB `weirdstuff.sqlite`

## Out of scope (per brief)
External pages under `docs/` outside msg.mesh (Brew, etc.) — not inventoried here.
