# MODULE CATALOG — proposed modular architecture (2026-10-22)

Maps every current file/export to the target taxonomy. Taxonomy (user-mandated base):
`js/bootstrap/`, `js/core/`, `js/domains/*`, `js/infrastructure/*`, `js/shared/`, `js/adapters/`,
`css/`, `tests/`, `docs/`. No empty placeholder files; only real units.

Legend: CUR = current file · TGT = target module · LOC = current lines · STABILITY = API surface frozen? · RISK = migration risk (L/M/H)

## Bootstrap (classic scripts, must stay non-module for CSP + pre-paint)
| Unit | CUR | TGT | LOC | Notes |
|---|---|---|---|---|
| frame guard | frameguard.js | js/bootstrap/frameguard.js | 7 | byte-identical move |
| theme pre-paint | theme-apply.js | js/bootstrap/theme-apply.js | 13 | byte-identical move; reads localStorage only |

## Core (app kernel: state, events, session identity)
| Unit | CUR | TGT | LOC | Exports (public API) |
|---|---|---|---|---|
| state store | store.js | js/core/state.js | 619 | state, on, emit, resetState, ingest/ingestOne, pushLocal, conv, findMessage, maxRowid, unreadCount, conversationOrder, refreshConversations, primeUsers, rememberUser, refreshUser, loadProfile/saveProfile/clearProfileCache, friends/groups/roles/typing/blocks helpers, ROLE_RANK/roleRank/myRank/hasChatPerm |
| session | (inside main.js) | js/core/session.js | ~250 (extract) | startSession, logout, handleSessionLost, startFromToken, syncProfileFromServer, normalizeUser |
| router | (inside main.js) | js/core/router.js | ~40 (extract) | route, openChat, showEmpty, hashchange binding |
| config/base | (inside api.js) | js/infrastructure/api/base.js OR keep in api | — | base resolution belongs to infrastructure; see adapters |

## Domains (business capabilities; each = state slice + flows + optional UI wiring)
| Domain | CUR spread | TGT | Key flows |
|---|---|---|---|
| auth | main.js auth section, api login/register/change/reset | js/domains/auth/ | logon tiles, register dialog, change pw, forgot notice, admin reset pw |
| chat | main.js send/outbox/drafts/read/reply/edit/react/pin/delete + store messages + ui renderMessages | js/domains/chat/ | compose, send, retry, outbox, drafts, markRead, history windowing, message control |
| contacts | main.js friend requests/block + store friends + ui renderContacts | js/domains/contacts/ | search/add/accept/reject/remove, block/unblock, blocked list |
| groups | main.js newGroup + store groups + api group* | js/domains/groups/ | create group, member list, labels |
| presence | main.js presence/typing handlers + store online/typing | js/domains/presence/ | online set, typing TTL, snapshot |
| calls | call.js + main.js call UI/renderCallState/history | js/domains/calls/ | WebRTC machine + dialog + history |
| profile | main.js profile dialog + store profile + syncProfileFromServer | js/domains/profile/ | edit display/status/about/avatar/photo/banner, migration |
| moderation | main.js admin panel (users/mod/audit, mute, ban, reset pw) | js/domains/moderation/ | roles ladder UI, mute dialog, audit pane |
| search | main.js search dialog + api.searchMessages | js/domains/search/ | message search, jump-to-rowid |
| files | main.js handleFile/uploadWithProgress/prepareUpload/openAttachment + ui attachment cache | js/domains/files/ | upload (progress+compress), download, preview cache |

## Infrastructure (transport, persistence, platform)
| Unit | CUR | TGT | Notes |
|---|---|---|---|
| HTTP client | api.js | js/infrastructure/api/client.js | call(), ApiError, failover, timeouts, token binding |
| API surface | api.js `api` object | js/infrastructure/api/endpoints.js | pure endpoint map (contract surface — see CONTRACTS.md) |
| WS transport | ws.js | js/infrastructure/ws/ | connect/dispatch/heartbeat/watchdog/poll/reconnect |
| localStorage | scattered safeGet/safeSet + keys | js/infrastructure/storage/ | typed key registry (msg.mesh.*) + safe accessors |
| uploads XHR | main.js uploadWithProgress | js/infrastructure/upload.js | progress-capable POST (fetch has no upload progress) |
| notifications | notifications.js | js/infrastructure/notifications.js | unchanged |
| sounds | sound.js | js/infrastructure/sound.js | unchanged |
| theme engine | theme.js | js/infrastructure/theme/ | setTheme + icon map + observer |

## Shared (pure, no DOM/state; used by many domains)
| Unit | CUR | TGT | Notes |
|---|---|---|---|
| esc/initials/$ | ui.js head | js/shared/dom.js | $, esc, initials, isSafeImageDataUrl |
| emotes | ui.js emotes/emoteTokens + emoticons.js | js/shared/emotes.js | EMOTE_PAIRS, token→img, EMOTICONS table |
| msgBox/toast | ui.js | js/shared/msgbox.js, js/shared/toast.js | dialog primitives |
| formatting | ui.js fmtTime/dayLabel/fileSize | js/shared/format.js | pure |
| message line HTML | ui.js messageLineHtml | js/domains/chat/render-line.js | domain-owned rendering |

## Adapters (glue: DOM wiring per dialog/panel; thin, no business logic)
| Unit | CUR (main.js lines) | TGT |
|---|---|---|
| menubar | ~3290-3415 | js/adapters/menubar.js |
| call dialog | ~1499-1668 | js/adapters/call-dialog.js |
| admin panel | ~2911-3284 | js/adapters/admin-panel.js |
| profile dialog | ~1332-1469 | js/adapters/profile-dialog.js |
| emoji/sticker/gif picker | ~2023-2297 | js/adapters/emoji-picker.js |
| context menu | ~1737-2021 | js/adapters/msg-context-menu.js |
| settings dialog | ~1384-1389, 3461-3494 | js/adapters/settings-dialog.js |
| server watch | ~3541-3621 | js/adapters/server-watch.js |
| composer | ~1670-1735 | js/domains/chat/composer.js |

## CSS
| CUR | TGT | Notes |
|---|---|---|
| app.css (XP base) | css/base.css + css/themes/xp.css | split tokens/layout from theme skin |
| win98.css | css/themes/win98.css | override layer |
| north.css | css/themes/north.css | override layer |

## Entry
| CUR | TGT |
|---|---|
| js/main.js (3700) | js/main.js slim bootstrap (~150-250 L): resolve base, boot session, mount adapters |

## Extraction order constraint
main.js is the LAST to shrink: every domain/adapter is extracted only after its
tests exist. store.js/api.js/ws.js/call.js/ui.js move first (leaf-ward), then
main.js sheds sections one adapter at a time.
