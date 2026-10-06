# Obsidian All In One Minecraft Automation Engine

## Development

Requires Node.js 22 or newer. Mineflayer is pinned to 4.39.0. Each profile selects one of Mineflayer's tested Minecraft versions, from 1.8.8 through 26.1; new profiles default to 1.21.5.

1. Copy `.env.example` to `.env` and set a local database password so the development database can start.
2. Start PostgreSQL with `docker compose --profile psql up -d postgres`, or set `DATABASE=MYSQL` and `DB_PORT=3306` before starting MySQL with `docker compose --profile mysql up -d mysql`.
3. Run `npm run setup` to enter or verify database credentials and initialize the profile tables. The target database must already exist; this command creates or migrates application tables, not the database itself. Run `npm run setup:check` later to verify the saved connection and schema without prompting.
4. Run `npm run dev` and open the dashboard at `http://localhost:3000`.

`DATABASE` accepts `PSQL` or `MYSQL`. `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `DB_SSL` configure either driver. Dashboard and API use ports 3000 and 3002 in development; the 3D viewer is configured for port 3001.

Profiles store their server address, optional port, username, authentication mode, Minecraft version, and bot behavior toggles in the selected database. Account auth tokens are stored locally in the ignored `.auth-cache/` folder. Bot behaviors are disabled by default. Emergency leave disconnects below 4/20 health; auto eat starts at 14/20 hunger; hostile-mob defense targets supported mobs within 8 blocks; durability protection switches away with 10% durability remaining; and player greetings use a 10-minute per-player cooldown while the dashboard process is running. Combat does not target players, passive mobs, creepers, endermen, or wardens.

The Jobs sidebar currently contains Flat Surface. It saves profile-scoped X1/Y1/Z1 and X2/Y2/Z2 bounds plus an output chest location, then digs each column top-down in a Z-snake across X rows while preserving the floor at Y1 - 1. The inclusive vertical depth is limited to 4 blocks and areas are limited to 65,536 columns. Jobs require a connected bot and at least 16 dirt, stone, or cobblestone blocks for bridging. Mining progress is saved to the selected database. Water and lava blocks inside the volume are left untouched; if they prevent a safe route, the job stops with an error.

The default `.env` password is for local development only. Do not expose the dashboard on an untrusted network until access control is added; its API can send server chat and change the bot's inventory.