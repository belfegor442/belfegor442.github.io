# CONTRACTS — frozen interfaces for modular migration (2026-10-22)

Rule: during migration, public signatures below are FROZEN. Internal refactors
must keep these contracts byte-compatible so consumers and %TEMP% probes keep
passing. Breaking a contract requires updating every consumer + every probe in
the same change.

## 1. HTTP layer contract (api.js)

```
class ApiError extends Error { status: number; payload: object }
friendlyError(err: ApiError|Error): string        // user-facing copy, frozen strings
call(path, data, opts?): Promise<payload>          // POST JSON, X-Session-Token header
apiBase(): string
setApiBase(next: string): void
wsEndpoint(): string                               // http→ws + "/ws"
resolveApiBase(candidate?): Promise<string|null>
failoverBase(): Promise<string|null>
getToken()/setToken(next)
setOnUnauthorized(fn)/notifyUnauthorized()
setOnServerSwitch(fn)
lastUsername()/rememberUsername(u)
isHttpsUrl(u)/isLocalhost(u)/isAllowedBase(u)
```

Frozen error copy (tests assert exact strings):
- 0 network: "Cannot reach the msg.mesh server. Check your connection."
- 0 timeout: "The msg.mesh server took too long to respond — it may be busy. Try again in a moment."
- 401: "Your session is no longer valid. Please sign in again."
- 403: "You do not have permission to do that."
- 429: "Too many requests — slow down for a moment."

Session binding: every `call()` snapshots the token at issue time; late
responses after logout/switch throw ApiError(0, "session changed…") and never
mutate the newer session. Non-idempotent calls are NOT auto-replayed on
failover; idempotent ones are (single retry, `noFailover:true`).

## 2. Endpoint payload shapes (wire contract, server-owned)

Login response: `{session_token, user:{user_id, username, display_name, role, tenant_id, status, app_role, chat_permissions?}, profile?}`
Whoami: same user shape + `profile:{status_text, about, avatar, photo, banner}`
History item: `{rowid, message_id, sender_node_id, receiver_node_id, message_type, payload(json-string), created_at, edited_at?, deleted_at?, reactions?, pinned_at?}`
Send response: `{message_id, rowid?}`
mesh/conversations: `{conversations:[{peer, unread, last?, group?}]}`
read response: `{my_last_read_rowid?, peer_last_read_rowid?, reads?}`
friends list: `{friends:[{friendship_id, user_a, user_b, status, created_at}]}`
friends requests: `{requests:[{request_id, sender_user_id, receiver_user_id, status}]}`
roles list: `{users:[{user_id, username, display_name, app_role, muted, muted_until?, banned, banned_reason?, online?}], your_role, your_permissions[]}`
WS frames in: `{event, data}` with event ∈ mesh.message|call.signal|user.updated|presence|presence.snapshot|typing|read.state|error
WS frames out: `{type:"auth"|"ping"|"typing"|"call", ...}`
Call signal payload: `{action: invite|accept|decline|end|offer|answer|candidate, call_id, to, from?, media?, sdp?, candidate?}`

Message envelope (payload JSON): `{v:1, from, from_name, ts, text, attachment?, reply?{id,rowid,from,text}}`

## 3. Store contract (store.js)

```
state: singleton (see store.js shape — frozen field names)
on(type, fn): () => void            // returns unsubscribe
emit(type, detail?): void
ingest(items[]): string[]           // returns touched peers
ingestOne(item): conversation|null
pushLocal(peer, partial): message
conv(peer): conversation
resetState(): void                  // keeps profile? NO — profile kept; user/session cleared
ROLE_RANK = {member:0, moderator:1, admin:2, owner:3}
myRank(): number
hasChatPerm(perm: string): boolean
```

Event names (section 2 of DEPENDENCY-MATRIX) are frozen.

## 4. WS contract (ws.js)

```
connect(): void
disconnect(): void
forceReconnect(): void
isOpen(): boolean
sendFrame(obj): boolean             // raw JSON frame; false if socket closed
```

Behavior: auth frame carries session_token; heartbeat ping 30s; watchdog 2×fail
closes; poll fallback 20s after 2 failed reconnects; reconnect backoff
1s→30s cap + jitter; offline event forces close; 401 error frame →
notifyUnauthorized + hard stop.

## 5. UI primitives contract (ui.js / shared)

```
$(sel): Element|null
esc(s): string                      // & < > " ' → entities
initials(name): string
toast(text, isError?): void         // 3.5s, sound, icon Critical|Information
msgBox({title?, text?, icon?: question|info|error|warning, okLabel?, cancelLabel?}): Promise<"ok"|"cancel">
  // cancelLabel:"" hides Cancel; Esc/X/Cancel → "cancel"; default OK focused; Enter accepts
showAuth(tab?), showApp(), setAuthTab(tab)
selectLogonTile(which: "login"|"other")
isSafeImageDataUrl(url): boolean
applyAvatarPhoto(imgEl, textEl, photo): void
renderProfile/renderConnection/renderRequests/renderContacts/renderSidebar/renderMessages(opts)/renderChatHead/renderDetails
setActive(peer|null)
renderAll()
clearAttachmentImageCache(): void
```

renderMessages scroll modes: default/true = pin bottom; "auto" = pin only if
was at bottom (else new-msgs pill); false = caller manages (loadOlder).

## 6. Call machine contract (call.js)

```
callState(): {phase, peer, callId, role, media, muted, cameraOff, startedAt, localStream, remoteStream}
isCallActive(): boolean
startCall(target, kind): Promise<{ok, error?}>
acceptCall() / declineCall() / cancelCall() / endCall(notice?)
toggleMute(): boolean
toggleCamera(): boolean
dismissCall(): void
```

Phases: idle | preparing-out | ringing-out | ringing-in | preparing-in | connecting | in-call
Friends-only calls; one active call; ring timeout 45s; ICE grace 8s on
disconnected; events emitted: callstate, callinvite, callnotice.

## 7. Sound contract (sound.js)
```
playSound(name): void   // name ∈ startup|logon|logoff|message|click|menu|error|notification|call
primeSound(name): void
startRing() / stopRing(): void
window.__sfxLog: string[]   // QA observable
```

## 8. Theme contract (theme.js)
```
currentTheme(): "winxp"|"win98"|"north"
setTheme(name): void   // sets data-theme, persists, sweeps imgs, dispatches "msgmesh:theme"
```
`data-theme` attribute on <html> is the CSS switch (app.css base, win98/north override).

## 9. Auth/session copy (frozen; smoke_pw asserts)
- Session lost: "Session expired — please sign in again."
- Forgot pw msgBox: "Only the server administrator can reset a password. Contact them and ask them to reset your account — they can do it from the Admin Panel."
- Admin reset toast: "Password reset for <username>"
- Wrong current pw (change): "Current password is incorrect."
- Sign out toast: "Signed out" / "Signed out in another tab."
- Signed in toast: "Signed in as <name>"

## 10. Security invariants (must survive every refactor)
1. XSS: every dynamic string into innerHTML goes through esc() (ui.js) or
   textContent. emoteTokens runs AFTER esc.
2. Attachments: download always via <a download> + blob URL; never
   window.open(blob). Preview <img> only for allowlisted image MIME + size caps.
3. Session: token in localStorage (documented tradeoff); every async flow
   re-checks getToken() before mutating state (account-switch guard pattern).
4. Failover never replays non-idempotent POSTs; query ?api= never trusted
   without isAllowedBase + /health probe.
5. Calls friends-only; server relays signaling only; media P2P.
6. Admin UI gating (myRank/hasChatPerm) is courtesy only — server ladder is
   authoritative.
7. Profile cache scoped by msg.mesh.profileOwner; cleared on logout/switch.
8. CSP: script-src 'self' — no inline scripts; classic scripts only for
   frameguard + theme-apply.
