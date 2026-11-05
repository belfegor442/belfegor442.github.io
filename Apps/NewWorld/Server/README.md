# New World multiplayer server

The browser client is static and cannot host an authoritative shared world. This .NET 8 service provides private lobbies, authenticated WebSockets, server-validated actions, and PostgreSQL persistence. The persisted world record includes session metadata, a Gregorian world date, stable State IDs, government memberships, and a shared State treasury with daily accrual; legacy player treasuries are migrated into their assigned State.

## Run locally

Install Docker Compose, then run in PowerShell from `Apps\NewWorld`:

```powershell
$env:POSTGRES_PASSWORD = "choose-a-long-random-password"
docker compose up --build
```

Open the New World page, select **PLAYERS**, enter `http://localhost:5000` as the server URL, and test the connection. Create a world and share its invitation code. A lobby admits up to 20 human players, and multiple players can share a State government. The existing lobby assignment and start controls remain technical setup for this MVP; who approves admission is still a pending design decision, not an established political rule. New games start on 1 January 1500. Once started, connected players can vote to pause or resume; the owner-confirmed rule is a strict majority of currently connected players. Pending votes reset whenever the connected player set changes. New players cannot join after a world has started in this MVP.

The browser's sample figures are preview-only. There is no single-player simulation or local save; play requires a multiplayer server.

The State treasury and monthly balance are shared by all members. Each member's construction plots remain separate for now, while their building income and upkeep contribute to their selected government's finances.

The economic core can execute explicitly configured goods and production recipes on each authoritative world day. Facilities consume available inventory, reduce batch volume when inputs are scarce, and emit persistent production events; company inventories and facility progress are exposed in snapshots. No goods, companies, recipes, or stock are seeded as official Beleland data. Markets, demand and price formation, currency definitions, companies' balance sheets, employment, taxes, and credit remain incomplete.

Every multiplayer action now requires a client-generated order ID, the observed world version, and the selected government State. Orders persist their submission and target world dates, actor, and applicable permission set. The server derives the actor from the authenticated session, checks State membership, rejects stale versions, and records accepted and rejected results with stable machine-readable codes. Past target dates are rejected and future scheduling is explicitly unsupported until the clock can execute queued orders. Order mutations run against an isolated world copy; rejected mutations discard all partial changes, and only accepted world changes advance the public version. Economic orders are blocked unless the world is running; pause and resume votes are accepted only in the matching world state. Clock accumulator writes do not advance the public world version until a game day elapses. Each order result and its corresponding world event are saved atomically with the world; replaying an order ID returns its prior result without repeating effects. Events have a monotonic per-world sequence; authenticated snapshot recovery accepts the last received sequence and returns missed events alongside the current authoritative state. Older order records receive deterministic audit events during compatibility normalization. Authenticated `GET /api/games/{gameId}/orders` and `/api/games/{gameId}/events` endpoints read the histories. The browser persists its last event sequence and pending orders on the device, displays the pending count, and retries pending orders after reconnecting.

Economic actions check the active membership's permission set; unknown permission-set IDs fail closed. Current memberships receive the existing `government-member` permission set, and configurable roles and permission management are not available yet. Pause voting remains a game-wide vote by connected players.

The order protocol has stable typed intents for budgets, laws, appointments, treaties, mobilization, and projects. Administration, construction, pause/resume, and constitutional budget/law/office procedures have execution paths. Political procedures require an explicitly configured Constitution, institution, permission sets, and legal basis; approval rules also require an explicit quorum, threshold, and threshold denominator. Worlds do not receive invented political rules. Approved budget plans update the recorded government budget but are not yet connected to spending or accounting. Approved laws are recorded as in force with their effective world date, and office appointments affect officeholders only after any configured approval is complete. There is not yet a UI or API for configuring political institutions and constitutions, and the other known intents are explicitly rejected until their systems exist.

This is only a partial implementation of the first blocks, not completion of the 25-block game specification. The political model and constitutional procedure engine are partial: political configuration is not yet editable, and elections, executive controls, and opposition procedures are not implemented. Configurable roles, late-join approval, atomic backup recovery, and most economic, social, military, and diplomatic systems are also not implemented.

Run the deterministic simulation tests from the repository root:

```powershell
dotnet test .\Apps\NewWorld\Server.Tests\Server.Tests.csproj
```

## Deploy

Deploy this server and a PostgreSQL database on a host that supports long-running .NET services and WebSockets. Configure these environment variables on the server:

- `ConnectionStrings__NewWorld`: PostgreSQL connection string, kept in the hosting provider's secret manager.
- `NEW_WORLD_ALLOWED_ORIGINS`: semicolon-separated, exact browser origins allowed to call the API and open WebSockets, for example `https://belfegor442.github.io`.

Expose the API over HTTPS/WSS and enter its origin in the browser's **SERVER URL** field. Check `GET /api/health` before inviting players. GitHub Pages only hosts the browser files; it does not deploy this API or its database.

Run a single server instance for this MVP: WebSocket presence and the five-minute world clock are process-local. PostgreSQL persists game state, including world date, session version, memberships, shared State treasuries, and fractional daily economic accrual, but horizontal scaling, database backup automation, identity accounts, diplomacy, and moderation are not implemented yet.

Invitation codes and player tokens are generated with cryptographic randomness; only their hashes are stored in PostgreSQL. Player tokens are kept by the browser for reconnection. Disconnecting a device does not delete its player or pause a world while another player remains connected. The world clock pauses when no player is connected.
