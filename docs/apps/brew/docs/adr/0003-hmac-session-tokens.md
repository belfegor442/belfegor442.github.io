# ADR-0003: Stateless HMAC session and reconnect tokens

## Status

Accepted

## Context

The server must authenticate WS connections without accounts or a database, and
must let a dropped client resume the same player (acceptance requirement), while
keeping the deployment free of server-side session storage.

## Decision

`POST /auth {username}` validates/normalises the name and returns two
self-contained tokens (`server/auth/devAuthProvider.js`):

- `sessionToken`: `base64url(JSON).base64url(HMAC-SHA256(payload, BREW_SECRET))`
  with `{sub, typ:'session', exp, jti}`.
- `reconnectToken`: same construction with `typ:'reconnect'`.

Verification is constant-time (`timingSafeEqual`), type-checked and TTL-checked.
`HELLO` accepts either pair; reconnect re-attaches the previous player identity
(`rejoined: true`) and re-sends the authoritative `ROOM_SNAPSHOT`.

## Consequences

- Zero session state to lose on restart (only player records persist).
- Secret rotation invalidates outstanding tokens (accepted; TTL is 12 h).
- Real accounts can be added later behind the same `AuthProvider` interface.
