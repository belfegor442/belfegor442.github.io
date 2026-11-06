# New World multiplayer deployment

New World uses a central authoritative .NET 8 API, PostgreSQL persistence and WebSockets. GitHub Pages serves only the browser client; it cannot run the game server or database.

## Managed deployment

The repository includes a Render Blueprint in `render.yaml`.

1. Import this repository into Render and select the Blueprint deployment.
2. Review the service and PostgreSQL database plans and approve provisioning. The blueprint uses paid plans so the database is persistent; do not deploy it without reviewing the current provider pricing.
3. Wait until the web service reports healthy at `/api/health`.
4. The client is configured for `https://na-new-world-api.onrender.com`. If Render assigns a different hostname, update `window.NEW_WORLD_API` in `docs/Apps/NewWorld/index.html` to the actual service origin and publish the static site.

The API accepts the PostgreSQL URI supplied by Render through `DATABASE_URL`, converts it to an Npgsql connection string, and requires TLS for the managed database connection.

## Player experience

Players do not enter a server address. They only enter a player name, create a world, or paste an invitation code. The browser connects to the configured central service over HTTPS and WSS.

## Local development

Keep using `Apps/NewWorld/docker-compose.yml` with `ConnectionStrings__NewWorld` for local development. The managed deployment configuration does not change the local compose workflow.

## Important

A code deployment cannot provision a live public server inside GitHub Pages. The Blueprint makes the backend reproducible, but an owner must authorize the hosting/database resources before multiplayer is live for everyone.
