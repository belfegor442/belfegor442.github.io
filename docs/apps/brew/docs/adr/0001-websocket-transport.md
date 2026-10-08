# ADR-0001: Own RFC-6455 WebSocket server on plain Node HTTP

## Status

Accepted

## Context

BREW needs a low-latency duplex channel between browsers and the authoritative
simulation, with zero runtime dependencies (spec requirement) and no external
broker. GitHub Pages hosts only static files, so the game server runs separately.

## Decision

Implement RFC-6455 framing (handshake, text frames, ping/pong, close) directly on
Node's `http` server in `server/net/websocket.js`, upgraded per-connection in
`server/httpServer.js`, and speak JSON envelopes over it (`shared/protocol.js`).

- GUID `258EAFA5-E914-47DA-95CA-C5AB0DC85B11` verified against the RFC example.
- 8 KiB max frame, continuation frames rejected, text-only payloads.
- Application-level heartbeat (PING/PONG) on top of protocol ping for RTT.

## Consequences

- No broker/dependency supply chain; the whole app runs on `node server/index.js`.
- We own framing edge cases — covered by the WebSocket unit path and the
  two-client acceptance suite.
- JSON payloads are human-debuggable; binary codecs remain a possible future
  change behind the same envelope.
