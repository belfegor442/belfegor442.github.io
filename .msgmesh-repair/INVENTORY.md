# INVENTORY — msg.mesh (verified 2026-10-21)

Source of truth: real files under `docs/app/services/msg.mesh/` in the site-mobile
working tree (branch `main`, HEAD `a521de2` at inspection time).

## Counts (measured, not assumed)
- Code files: **16** (12 .js, 3 .css, 1 .html), **9099 lines**
- Assets: **238 files** (icons/sprites, emoticons, sounds, fonts, bliss.jpg)
- Total on disk: 255 files (all tracked by git)

## Code files

| File | Lines | Role | Imports (real) |
|---|---|---|---|
| main.js | 3456 | app entry, auth flows, chat UI, admin panel, menus, dialogs | api, store, ws, notifications, ui, sound, theme, call, emoticons |
| ui.js | 818 | DOM rendering: sidebar, chat, contacts, msgBox, toast, avatars | store, sound, api, emoticons |
| store.js | 562 | shared state, ingest/normalize, friends/groups/roles/typing | api |
| api.js | 405 | HTTP client, token, api-base resolution, ApiError | (none) |
| ws.js | 315 | WebSocket connect/dispatch/reconnect | api, store |
| call.js | 443 | WebRTC voice/video + signaling | store, ws, api, sound |
| emoticons.js | 114 | emoticon table + file names | (none) |
| theme.js | 106 | theme set/persist | (none) |
| sound.js | 68 | XP sounds + ring loop | (none) |
| notifications.js | 29 | Notification API wrapper | (none) |
| theme-apply.js | 13 | early theme bootstrap | (none) |
| frameguard.js | 7 | clickjacking frame guard | (none) |
| app.css | 1082 | XP Luna theme (default) | — |
| win98.css | 684 | Win98 theme | — |
| north.css | 502 | North dark theme | — |
| index.html | 495 | single-page markup (dialogs, logon, app frame) | — |

## Dependency graph (verified via import statements)
```
api.js ────────────┬──────────────────────────┐
   │               │                          │
store.js ──┬── ws.js                         sound.js (leaf)
   │       │          │                        │
   │       └── call.js ├── ui.js ── emoticons.js (leaf)
   │                   │
   └────────────── main.js (imports all of the above + notifications, theme)
theme.js (leaf) · theme-apply.js (leaf) · frameguard.js (leaf) · notifications.js (leaf)
```
Layers: leaves (api/theme/sound/emoticons/notifications/frameguard/theme-apply) →
store → ws → ui/call → main (composition root).

## Non-code runtime assets referenced by code
- `assets/xp/sounds/*.wav` (9): strtup, logon, logoff, msg.recived, click, menu, error, notification, call
- `assets/xp/sprites/*` (scrollbars no longer used by app.css; window chrome sprites still used)
- `assets/xp/emoticons/*` (gif/png), `assets/xp/gifs/sticker_*.gif`
- `manifest.webmanifest`

## Server counterpart (separate repo, S:\)
- `server/src/api_service.cpp` (~9k lines) serves /api/v1/* used by api.js
- migration 021: app_role/user_mutes/user_bans; e2e roles_test.py = 118 checks
