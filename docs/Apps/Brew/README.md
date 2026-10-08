# BREW

Server-authoritative 2.5D social arcade game (pub with machines, chat, sabotage, challenges).

This folder currently contains **two builds**:

| Entry | Stack | Needs a server? |
| --- | --- | --- |
| `index.html` + `app.js` + `src/` | Static client, MQTT brokers, host-authority relays, hand-written WebGL renderer (`src/render.js` + `src/renderGeo.js`, zero deps) | No (pure GitHub Pages) |
| `play.html` + `client/` + `server/` | Node WebSocket server, authoritative rooms/machines, 2.5D canvas renderer | Yes (`npm start`) |

The MQTT build renders in real 3D: perspective camera, vertex-lit geometry, fog,
shadows and additive light pools — all hand-written WebGL (no three.js), with an
overlay 2D canvas for nametags, chat bubbles and seat rings.

The rest of this README describes the **server-authoritative build** (`server/`, `client/`, `shared/`).

## Quick start

```bash
npm start          # http://127.0.0.1:8137  (WS at /ws, REST at /auth)
npm test           # unit + integration + acceptance (node --test)
npm run typecheck  # node --check on server/shared/client entry points
```

Open `play.html` through the server (`serveStatic` defaults on) or via any static host
pointing at a running instance. Configuration comes from `config/*.env` overridden by
environment variables (`BREW_PORT`, `BREW_HOST`, `BREW_DB_ENABLED`, `BREW_LOG_LEVEL`, …).

## Architecture

```
shared/     constants + protocol envelopes + pure machine math (used by both sides)
server/
  index.js          composition root (createApp / start / stop)
  httpServer.js     REST: POST /auth, GET /healthz /readyz /metrics, static files
  gameServer.js     WS session lifecycle, dispatch, rate limiting, ACK/error replies
  net/              RFC-6455 WebSocket implementation (zero dependencies)
  auth/             HMAC-signed session + reconnect tokens
  rooms/            Room, RoomManager, roomActions (move/mount/machine/chat/ready)
  game/             machine, world, sabotage, achievements
  persistence/      JSON file player store (atomic tmp+rename writes, periodic flush)
  security/         token-bucket rate limiter per message category
client/
  main.js    orchestrator: game loop, event routing, visibility handling
  net.js     WS client with request/pending map and replay-safe event dispatch
  store.js   client-side world state (players, machines, room phase)
  input.js / render.js / ui.js / audio.js
tests/
  unit/         pure logic (math, limiter, store, achievements, world, sabotage)
  integration/  RoomManager + roomActions with fake connections
  acceptance/   real HTTP+WS server driven by two independent clients
```

### Authoritative loop

- 20 Hz tick per room (`tickLoop`): movement from intents, machine ticks, effect expiry,
  mischief regen, phase transitions.
- State deltas broadcast every 2nd tick as `ROOM_STATE` (dirty players only).
- Discrete outcomes broadcast immediately as `ROOM_EVENT`
  (`MACHINE_SPIN/STOP/ROUND_END`, `CHAT`, `BEER_THROW`, `PLAYER_JOINED`, …)
  plus targeted `MACHINE_SYNC` snapshots for the actor/controller/spectators.

### Protocol

Envelope: client → `{type, requestId, timestamp, payload}`,
server → `{type, requestId?, sequence, roomSequence?, event?, payload, serverTime}`.

- `ACK {ok}` confirms non-quiet actions; `ERROR {code, …}` rejects them.
- Quiet actions (`MOVE`, `REACTION`, `CHAT`, `REQUEST_STATE_SYNC`) send no `ACK`.
- `HELLO → SESSION_ESTABLISHED` and `ROOM_LIST → ROOM_LIST_RESULT` reply on the same
  `requestId` (no separate ACK).
- Rate limits are token buckets per category (`MOVE`, `MACHINE_INPUT`, `SABOTAGE`,
  `CHAT`, `AUTH`, …) — see `shared/constants.js#RATE_LIMITS`.

### Reconnect

`POST /auth` issues `sessionToken` + `reconnectToken` (HMAC-SHA256, TTL-bound).
Dropping the socket marks the player `DISCONNECTED` and announces
`PLAYER_DISCONNECTED {graceMs}`; reconnecting with the tokens re-attaches the same
player, restores room/machine state and announces `PLAYER_RECONNECTED`.

## Tests

```bash
npm run test:unit
npm run test:integration
npm run test:acceptance   # boots the real server on an ephemeral port, two WS clients
```

The acceptance suite covers the full acceptance scenario: sign-in, room discovery,
join, authoritative movement, station mount, machine round, sabotage, chat,
disconnect/reconnect with state restore, ready/start flow and leave.
