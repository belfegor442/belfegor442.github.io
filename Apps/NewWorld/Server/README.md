# New World multiplayer server

The browser client is static and cannot host an authoritative shared world. This .NET 8 service provides private lobbies, authenticated WebSockets, server-validated actions, and PostgreSQL persistence. The persisted world record includes session metadata, a Gregorian world date, stable State IDs, and government memberships; legacy JSONB saves are normalized on read.

## Run locally

Install Docker Compose, then run in PowerShell from `Apps\NewWorld`:

```powershell
$env:POSTGRES_PASSWORD = "choose-a-long-random-password"
docker compose up --build
```

Open the New World page, select **PLAYERS**, enter `http://localhost:5000` as the server URL, and test the connection. Create a world and share its invitation code. A lobby admits up to 20 human players, and multiple players can share a State government. The existing lobby assignment and start controls remain technical setup for this MVP; who approves admission is still a pending design decision, not an established political rule. New games start on 1 January 1500. Once started, connected players can vote to pause or resume; the owner-confirmed rule is a strict majority of currently connected players. Pending votes reset whenever the connected player set changes. New players cannot join after a world has started in this MVP.

The browser's sample figures are preview-only. There is no single-player simulation or local save; play requires a multiplayer server.

This is only the Phase A foundation. Political institutions, permission-specific orders, a treasury shared by government members, late-join approval, durable order history/idempotency, atomic backup recovery, and most economic, social, military, and diplomatic systems are not implemented.

Run the deterministic simulation tests from the repository root:

```powershell
dotnet test .\Apps\NewWorld\Server.Tests\Server.Tests.csproj
```

## Deploy

Deploy this server and a PostgreSQL database on a host that supports long-running .NET services and WebSockets. Configure these environment variables on the server:

- `ConnectionStrings__NewWorld`: PostgreSQL connection string, kept in the hosting provider's secret manager.
- `NEW_WORLD_ALLOWED_ORIGINS`: semicolon-separated, exact browser origins allowed to call the API and open WebSockets, for example `https://belfegor442.github.io`.

Expose the API over HTTPS/WSS and enter its origin in the browser's **SERVER URL** field. Check `GET /api/health` before inviting players. GitHub Pages only hosts the browser files; it does not deploy this API or its database.

Run a single server instance for this MVP: WebSocket presence and the five-minute world clock are process-local. PostgreSQL persists game state, including world date, session version, memberships, and fractional daily economic accrual, but horizontal scaling, database backup automation, identity accounts, diplomacy, and moderation are not implemented yet.

Invitation codes and player tokens are generated with cryptographic randomness; only their hashes are stored in PostgreSQL. Player tokens are kept by the browser for reconnection. Disconnecting a device does not delete its player or pause a world while another player remains connected. The world clock pauses when no player is connected.
