# DEPENDENCIES — verified 2026-10-21

## Import edges (static, from source)
- store.js → api.js (apiGet/apiPost, token)
- ws.js → api.js (token, apiBase) · ws.js → store.js (ingest, typing, presence)
- ui.js → store.js, sound.js, api.js, emoticons.js
- call.js → store.js, ws.js (sendFrame signaling), api.js, sound.js
- main.js → api, store, ws, notifications, ui, sound, theme, call, emoticons

## Runtime contracts (cross-module)
| Producer | Contract | Consumers |
|---|---|---|
| api.api | {ok,data}| throws ApiError{status,message} | store, ui, call, main |
| ws.sendFrame | JSON frame {t,payload} | call (offer/answer/candidate), main (typing, presence) |
| store.on/emit | event names: messages, conversations, contacts, typing, presence, roles, connection | ui.render*, main |
| ui.msgBox | {title,text,icon,cancelLabel} Promise<boolean> | main (call failure, destructive confirms) |
| sound.playSound | name ∈ 9 wav files | main, call, ui (click) |
| theme.setTheme | xp|win98|north → <link id=themeCss> | main settings |

## Change-impact rules (used in repair rounds)
- Any edit in store.js ingest/normalize → re-run roles_test (118) + smoke_call_msgbox
- Any edit in api.js error path → prod_smoke_pw (401/403 handling) + roles_test
- Any edit in ws.js dispatch → roles_test + manual reconnect observation
- Any edit in ui.js render → smoke_call_msgbox (msgBox contract) + scrollbar smoke
- Any edit in main.js auth → prod_smoke_pw + roles_test login paths
- index.html markup change → grep ids used by JS and by tests (tileOther, authUsername, changePw*, resetPw*)
