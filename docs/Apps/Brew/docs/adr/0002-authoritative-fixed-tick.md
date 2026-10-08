# ADR-0002: Server-authoritative rooms on a fixed 20 Hz tick

## Status

Accepted

## Context

Clients send intents (movement direction, machine inputs); trusting client
positions or client-side timers would allow cheating and divergent state between
players, breaking the acceptance requirement that disconnect/reconnect restores
one authoritative world.

## Decision

- Every room runs `tickLoop` at 20 Hz (`TICK_RATE`, dt clamped to 250 ms).
- Clients send `MOVE {dx,dz}` intents; the server integrates them through
  `applyMovement` (world clamp + obstacle resolution) and owns positions.
- Machine rounds are pure functions of server state + time
  (`shared/machineMath.js`), with latency compensation clamped to 400 ms on STOP.
- Discrete outcomes broadcast immediately as `ROOM_EVENT`; positions/animation
  deltas coalesce into `ROOM_STATE` every 2nd tick (10 Hz), dirty-set only.

## Consequences

- Cheating reduces to sending plausible intents; scores/heat/combo only change
  server-side.
- Reconnect is trivially correct: the room snapshot *is* the truth.
- 10 Hz position updates keep bandwidth linear in changed players, not in players.
