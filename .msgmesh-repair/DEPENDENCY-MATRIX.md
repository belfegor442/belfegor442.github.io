# DEPENDENCY MATRIX — verified 2026-10-22

## 1. Module import edges (static, from source)

| From → To | api | store | ws | ui | call | sound | theme | emoticons | notifications |
|---|---|---|---|---|---|---|---|---|---|
| api.js | — | | | | | | | | |
| store.js | ✓ | — | | | | | | | |
| ws.js | ✓ | ✓ | — | | | | | | |
| ui.js | ✓ | ✓ | | — | | ✓ | | ✓ | |
| call.js | ✓ | ✓ | ✓ | | — | ✓ | | | |
| main.js | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| emoticons/theme/sound/notifications/theme-apply/frameguard | — | — | — | — | — | — | — | — | — |

No cycles. api.js is the only module with zero imports.

## 2. Event bus (`on`/`emit`) — producer → event → consumers

| Event | Producer | Consumers (main.js unless noted) |
|---|---|---|
| connection | ws.js | main (renderConnection, retry burst), call.js (teardown on drop) |
| sync | ws.js | main (#syncState text) |
| messages | ws.js→store.ingest | main (render, sound, notify, markRead) |
| conversations | ws.js, store.refreshConversations | main (sidebar, chat head) |
| call | ws.js | call.js (onSignal) |
| callstate | call.js | main renderCallState |
| callinvite | call.js | main renderCallState |
| callnotice | call.js | main toast |
| servererror | ws.js | call.js (abort call), main |
| userupdated | ws.js | main (profile/users refresh) |
| presence | ws.js | main (online set) |
| presence.snapshot | ws.js | main (online set) |
| typing | ws.js | main (typing TTL) |
| readstate | ws.js | main (sidebar, chat head) |
| friends | main (loadFriends) | main emitFriends |
| roles | main (loadRoles) | main (tools menu, admin, send enable) |
| theme (window CustomEvent `msgmesh:theme`) | theme.js | (none today; reserved) |

## 3. API endpoint map (api.js `api` object → server routes)

| Client call | Route | Idempotent? | Domain |
|---|---|---|---|
| health | GET /health | yes | infra |
| login | POST /api/v1/users/login | no (30s timeout) | auth |
| register | POST /api/v1/users/register | no (30s) | auth |
| whoami | POST /api/v1/auth/whoami | yes | session |
| logout | POST /api/v1/auth/logout | yes | session |
| changePassword | POST /api/v1/users/change_password | no | auth |
| resetPassword | POST /api/v1/users/reset_password | no | moderation (owner) |
| history | POST /api/v1/mesh/history | yes | chat |
| send | POST /api/v1/mesh/send | yes (client_msg_id) | chat |
| meshConversations | POST /api/v1/mesh/conversations | yes | chat |
| read | POST /api/v1/mesh/read | yes | chat |
| searchMessages | POST /api/v1/mesh/search | yes | search |
| editMessage | POST /api/v1/mesh/edit | yes | chat |
| deleteMessage | POST /api/v1/mesh/delete | yes | chat |
| reactMessage | POST /api/v1/mesh/react | yes | chat |
| pinMessage | POST /api/v1/mesh/pin | yes | chat |
| usersSearch | POST /api/v1/users/search | yes | contacts |
| usersGet | POST /api/v1/users/get | yes | contacts |
| usersUpdate | POST /api/v1/users/update | yes | profile |
| friendsList/Requests/Request/Accept/Reject/Remove | /api/v1/friends/* | mixed | contacts |
| blockUser/unblockUser/blocksList | /api/v1/friends/block|unblock|blocks | yes | contacts |
| groupCreate | POST /api/v1/groups/create | no | groups |
| groupsList | POST /api/v1/groups/list | yes | groups |
| chatRolesList/RoleSet/UserMute/UserUnmute/UserBan/UserUnban | /api/v1/chat/* | mostly no | moderation |
| chatModRecent/ModMessage/GroupManage/Audit | /api/v1/chat/* | read=Yes | moderation |
| callHistory/callsIce | /api/v1/calls/* | yes | calls |
| upload/download | /api/v1/files/* | upload=no, download=yes | files |

## 4. localStorage keys (must migrate to typed registry)

| Key | Writer | Reader | Notes |
|---|---|---|---|
| msg.mesh.api | api.setApiBase | api.resolveApiBase | server base URL |
| msg.mesh.token | api.setToken | api, main | session token (auth boundary) |
| msg.mesh.lastUser | api.rememberUsername | main boot | username prefill |
| msg.mesh.theme | theme.setTheme | theme-apply, theme | winxp\|win98\|north |
| msg.mesh.profile | store.saveProfile | store.loadProfile | cached profile |
| msg.mesh.profileOwner | main syncProfileFromServer | main | account scoping guard |
| msg.mesh.profileMigrated.<uid> | main | main | one-shot migration flag |
| msg.mesh.outbox.<uid> | main outbox* | main restoreOutbox | undelivered sends |
| msg.mesh.drafts.<uid> | main saveDraft | main restoreDraft | per-peer drafts |

## 5. DOM id surface (index.html ↔ JS ↔ tests)

Critical ids (tests depend — do not rename): authView, authForm, authUsername, authPassword,
authSubmit, authError, authHint, tileKnown, tileOther, logonFields, rowUsername, rowPassword,
capsWarn, forgotPwBtn, w98CancelBtn, addAccountBtn, knownName,
regForm/regUsername2/regPassword2/regDisplay2/regError/regSubmit2/regBack2/regClose,
appView, menuBar, toolsMenuSlot,
conversationList, requestStrip, contactResults, messageList, messages, messageInput, sendBtn,
loadOlder, newMsgsPill, charCount, pendingFile, pendingFileName, replyBar, editBar,
emojiPanel/emojiBtn/emojiFaces/emojiStickers/gifPane/gifSearch/gifGrid/gifStatus,
chatPanel, chatName, chatMeta, chatAvatar, chatCallBtn, chatVideoBtn, chatSearchBtn, chatInfoBtn, backBtn,
details, closeDetails, addContactBtn, removeContactBtn, blockContactBtn, sharedFiles, sharedFilesBlock,
pinnedStrip, ctxMenu, ctxReply, ctxEdit, ctxReact, ctxReactGrid, ctxPin, ctxDelete, ctxCopy,
toasts, connection, connLabel, syncState, allCount, unreadCount, onlineCount, offlineCount,
settingsDialog, profileServer, serverApply, serverHint, logoutBtn, showTimestamps, blockedList,
profileDialog, profileForm, profileDisplayName, profileStatusText, profileAbout, profileAvatarField,
profilePhoto*, profileBanner*, profileSave, profileStatus,
changePwDialog, changePwForm, curPw, newPw, newPw2, changePwSave, changePwError,
adminPanelDialog, adminTabUsers, adminTabMod, adminTabAudit, adminUsersPane, adminModPane, adminAuditPane,
adminRefresh, adminRoleHint, adminStatus, admin-reset-pw, adminResetPwDialog, adminResetPwWho/New/Submit/Status/Cancel/Close,
muteDialog, muteForm, muteWho, muteMinutes, muteReason, muteSubmit, muteStatus,
callDialog, callAcceptBtn, callDeclineBtn, callMuteBtn, callCameraBtn, callCancelBtn, callHangupBtn, callClose,
callRemoteAudio, callRemoteVideo, callLocalVideo, callVideoStage, callStatus, callTimer,
callHistoryDialog, callHistoryList, callHistoryRefresh,
newChatDialog, newChatForm, newChatInput, newChatResults, newChatStatus,
searchDialog, searchForm, searchInput, searchResults,
newGroupDialog, newGroupForm, newGroupInput, newGroupMembers, newGroupCreate, newGroupStatus,
aboutDialog, aboutOk,
msgBoxDialog, msgBoxTitle, msgBoxText, msgBoxIcon, msgBoxOk, msgBoxCancel, msgBoxClose,
fileInput.

## 6. Change-impact rules (repair + migration)
- store.js ingest/normalize edit → roles_test (118) + smoke_call_msgbox + prod_smoke
- api.js error/failover path → prod_smoke_pw + roles_test + verify 401 copy
- ws.js dispatch edit → roles_test + manual reconnect + probe_d9_call
- ui.js render edit → smoke_call_msgbox + smoke_statusbar + axe a11y
- main.js auth edit → prod_smoke_pw + reset password flows (smoke_pw 23)
- index.html id/markup change → grep tests for the id before rename; update %TEMP% probes
- index.html CSP edit → full smoke battery (script-src 'self' is load-bearing)
