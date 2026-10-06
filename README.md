# Obsidian All In One Minecraft Automation Engine

## Development

Requires Node.js 22 or newer. Mineflayer is pinned to 4.39.0. Each profile selects one of Mineflayer's tested Minecraft versions, from 1.8.8 through 26.1; new profiles default to 1.21.5.

1. Copy `.env.example` to `.env` and set a local database password so the development database can start.
2. Start PostgreSQL with `docker compose --profile psql up -d postgres`, or set `DATABASE=MYSQL` and `DB_PORT=3306` before starting MySQL with `docker compose --profile mysql up -d mysql`.
3. Run `npm run setup` to enter or verify database credentials and initialize the profile tables. The target database must already exist; this command creates or migrates application tables, not the database itself. Run `npm run setup:check` later to verify the saved connection and schema without prompting.
4. Run `npm run dev` and open the dashboard at `http://localhost:3000`.

`DATABASE` accepts `PSQL` or `MYSQL`. `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `DB_SSL` configure either driver. Dashboard and API use ports 3000 and 3002 in development; the 3D viewer is configured for port 3001.

Profiles store their server address, optional port, username, authentication mode, and Minecraft version in the selected database. Account auth tokens are stored locally in the ignored `.auth-cache/` folder. The dashboard does not include automated behaviors.

The default `.env` password is for local development only. Do not expose the dashboard on an untrusted network until access control is added; its API can send server chat and change the bot's inventory.