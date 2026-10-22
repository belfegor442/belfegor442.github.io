# MIGRATION PLAN — modular refactor in safe batches (2026-10-22)

Goal: restructure `docs/app/services/msg.mesh/` into the mandated taxonomy
WITHOUT changing behavior, copy, ids, or wire contracts. Every batch is
independently shippable: at the end of each batch the full smoke battery is
green and the tree builds/serves identically.

## Ground rules (every batch)
1. **Strangler pattern**: create the new module path; re-export from the old
   path; flip importers gradually; delete the old path only when zero importers
   remain. During the transition, `js/api.js` may become a one-line re-export
   of `js/infrastructure/api/index.js`.
2. **Contracts frozen** (see CONTRACTS.md). No signature/copy changes.
3. **Byte-identical moves** for leaves first (frameguard, theme-apply,
   emoticons, notifications, sound) — `git mv` + import path fix only.
4. **Tests gate every batch**: after each batch run the full battery
   (ws 250 + roles 118 + prod 5 + smoke_pw 23 + msgbox 9 + statusbar 8 +
   a11y 2 + themes 2 + dialogs 5 = 444). Any red → fix before proceeding.
5. **No `git add -A`** in site-mobile (Brew noise). Stage only msg.mesh paths.
6. **CRLF/mojibake**: write UTF-8 no-BOM; verify served bytes for U+2014/U+2026
   after any main.js/ui.js edit (D-13 lesson).
7. **index.html script/link hrefs** update in the SAME commit as the move.
8. Server repo (S:\) untouched — migration is client-only.

## Batch 0 — scaffold + guardrails (no behavior change)
- Create empty-but-real dirs only as files land later (no placeholder .gitkeep).
- Add `js/shared/dom.js` with `$`, `esc`, `initials`, `isSafeImageDataUrl`
  moved from ui.js; ui.js re-exports them (preserve `export { $, esc, … }` names
  so main.js imports keep working).
- Add smoke script `check_imports.py` (%TEMP%\opencode): parse every js file
  for `from "./…"` edges; fail on cycles or imports that escape the subtree.
- Deliverable: dependency checker green; battery green.

## Batch 1 — leaf modules (byte moves)
- `js/emoticons.js` → `js/shared/emoticons.js`
- `js/sound.js` → `js/infrastructure/sound.js`
- `js/notifications.js` → `js/infrastructure/notifications.js`
- `js/theme.js` → `js/infrastructure/theme/index.js`
- `js/frameguard.js` → `js/bootstrap/frameguard.js`
- `js/theme-apply.js` → `js/bootstrap/theme-apply.js`
- Old paths become re-export shims (or direct import flips — 6 files, cheap).
- index.html: update the two classic script srcs + module imports.
- Battery green; node --check all files.

## Batch 2 — API infrastructure split
- Split api.js into:
  - `js/infrastructure/api/base.js` — base resolution, probe, failover, candidates
  - `js/infrastructure/api/client.js` — call(), ApiError, timeouts, token, hooks
  - `js/infrastructure/api/endpoints.js` — the `api` object (pure map)
  - `js/infrastructure/api/index.js` — public surface (re-export all current names)
- `js/api.js` → `export * from "./infrastructure/api/index.js"` shim.
- Callers unchanged. Battery green (prod_smoke_pw + roles_test critical).

## Batch 3 — WS transport
- `js/ws.js` → `js/infrastructure/ws/index.js` with
  same exports: connect, disconnect, forceReconnect, isOpen, sendFrame.
- `js/ws.js` shim. Battery green; manual reconnect observation.

## Batch 4 — store → core/state + domain slices
- `js/store.js` → `js/core/state.js` (state, on, emit, resetState, conv, ingest*).
- Extract pure helpers that don't touch api.js into `js/core/selectors.js`
  (unreadCount, conversationOrder, peerLabel, peerOnline, isTyping, …).
- Keep network loaders (loadFriends/loadBlocked/loadGroups/loadRoles/
  refreshConversations/primeUsers/rememberUser/refreshUser) in
  `js/core/sync.js` (they import endpoints).
- `js/store.js` re-exports everything under old names.
- Battery green (roles_test + prod_smoke + statusbar).

## Batch 5 — UI split (render + primitives)
- `js/shared/msgbox.js` ← msgBox
- `js/shared/toast.js` ← toast
- `js/shared/format.js` ← fmtTime, dayKey, dayLabel, fileSize
- `js/shared/emotes.js` ← EMOTE_PAIRS/emotes/emoteTokens + re-export emoticons table
- `js/domains/chat/render-line.js` ← messageLineHtml, statusGlyph, renderPinnedStrip
- `js/domains/chat/render-messages.js` ← renderMessages + attachment image cache
- `js/domains/chat/render-sidebar.js` ← renderSidebar, contactRowHtml, rowMeta, roleBadge
- `js/domains/contacts/render.js` ← renderContacts, renderRequests
- `js/domains/profile/render.js` ← renderProfile, renderDetails
- ui.js becomes a thin barrel re-exporting old names.
- Battery green (msgbox, statusbar, a11y, dialogs).

## Batch 6 — main.js sheds auth + session
- Extract `js/core/session.js`: normalizeUser, startSession, logout,
  handleSessionLost, startFromToken, syncProfileFromServer, storage-tab sync.
- Extract `js/domains/auth/`: login form wiring, register dialog, change pw,
  forgot notice, caps lock, tiles.
- Extract `js/core/router.js`: route, openChat, showEmpty, hashchange.
- main.js keeps: boot() call + remaining wiring. Battery green (prod_smoke_pw 23).

## Batch 7 — main.js sheds chat composer/sending
- `js/domains/chat/send.js`: sendMessage, retryMessage, isRetryableSendError
- `js/domains/chat/outbox.js`: outbox/drafts localStorage
- `js/domains/chat/history.js`: ensurePeerHistory, loadOlder, markRead, jumpTo
- `js/domains/chat/composer.js`: msgInput wiring, typing throttle, char count,
  pill/scroll, reply/edit bars
- `js/domains/files/`: handleFile, prepareUploadFile, uploadWithProgress,
  openAttachment, fileInput
- Battery green (prod_smoke + msgbox).

## Batch 8 — main.js sheds adapters
- `js/adapters/menubar.js`, `call-dialog.js`, `admin-panel.js`,
  `profile-dialog.js`, `settings-dialog.js`, `emoji-picker.js`,
  `msg-context-menu.js`, `server-watch.js`, `presence-typing.js`,
  `contacts-actions.js` (request strip, add/remove/block buttons),
  `groups-dialog.js`, `search-dialog.js`, `newchat-dialog.js`,
  `call-history-dialog.js`.
- Each adapter: DOM wiring only; business calls via domains/infrastructure.
- main.js target ≤ 300 lines (imports + boot + mount).
- Battery green (full).

## Batch 9 — CSS restructure
- `css/app.css` → `css/base.css` (tokens, reset, layout, components) +
  `css/themes/xp.css` (XP skin, default).
- `css/win98.css` → `css/themes/win98.css`
- `css/north.css` → `css/themes/north.css`
- index.html stylesheet hrefs update. Visual diff via Playwright screenshots
  (5 viewports × 3 themes) vs pre-batch captures — pixel-compare or manual
  eyeball on logon + chat + dialogs.
- Battery green + a11y + themes smokes.

## Batch 10 — delete shims + final audit
- Remove all re-export shims; grep for old paths must be empty.
- Final: node --check 12+ modules, check_imports.py, full 444 battery,
  axe on 7 remaining dialogs (pending from R55), M50 informe.
- Update INVENTORY.md + MODULES.md + PROGRESS.md with final layout.
- Commit(s) staged to msg.mesh paths only.

## Batch size / risk notes
- Batches 1-2 are near-zero risk (moves + shims).
- Batch 4 is the riskiest (store is the hub): budget extra verification.
- Batch 8 is the largest diff (main.js 3700 → ~250): split into 8a-8h
  sub-commits (one adapter each) if a single commit is too big to review.
- Never combine a behavior fix with a migration batch — repairs land on the
  pre-migration tree or as a separate commit after the batch.

## Rollback
Each batch = 1 commit (or small series). `git revert` of the batch commit
restores old paths (shims make mid-state safe). Probes in %TEMP%\opencode
reference public ids, not file paths, so they survive reverts.
