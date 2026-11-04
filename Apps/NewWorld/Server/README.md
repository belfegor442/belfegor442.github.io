# New World multiplayer server

The browser client is static and cannot host an authoritative shared world. This .NET 8 service provides private lobbies, host-controlled state assignment, authenticated WebSockets, server-validated claims and construction, and PostgreSQL persistence.

## Run locally

Install Docker Compose, then run in PowerShell from `Apps\NewWorld`:

```powershell
$env:POSTGRES_PASSWORD = "choose-a-long-random-password"
docker compose up --build
```

Open the New World page, select **PLAYERS**, enter `http://localhost:5000` as the server URL, and test the connection. Create a world and share its invitation code. Players join in the lobby; the host assigns a state to each player before starting the game. New players cannot join after a world has started in this MVP.

## Deploy

Deploy this server and a PostgreSQL database on a host that supports long-running .NET services and WebSockets. Configure these environment variables on the server:

- `ConnectionStrings__NewWorld`: PostgreSQL connection string, kept in the hosting provider's secret manager.
- `NEW_WORLD_ALLOWED_ORIGINS`: semicolon-separated, exact browser origins allowed to call the API and open WebSockets, for example `https://belfegor442.github.io`.

Expose the API over HTTPS/WSS and enter its origin in the browser's **SERVER URL** field. Check `GET /api/health` before inviting players. GitHub Pages only hosts the browser files; it does not deploy this API or its database.

Run a single server instance for this MVP: WebSocket presence and the five-minute world clock are process-local. PostgreSQL persists game state, but horizontal scaling, database backup automation, identity accounts, diplomacy, and moderation are not implemented yet.

Invitation codes and player tokens are generated with cryptographic randomness; only their hashes are stored in PostgreSQL. Player tokens are kept by the browser for reconnection. Disconnecting a device does not delete its player or pause a world while another player remains connected. The world clock pauses when no player is connected.
