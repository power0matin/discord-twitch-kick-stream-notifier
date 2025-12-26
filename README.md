# Discord Twitch/Kick Stream Notifier Bot
<p align="center">
  <a href="#"><img src="https://badges.strrl.dev/visits/power0matin/discord-twitch-kick-stream-notifier?style=flat&labelColor=333333&logoColor=E7E7E7&label=Visits&logo=github" alt="Visits badge" /></a>
  <a href="#"><img src="https://img.shields.io/github/stars/power0matin/discord-twitch-kick-stream-notifier?style=flat&labelColor=333333&logoColor=E7E7E7&color=EEAA00&label=Stars&logo=github" alt="Stars badge" /></a>
  <a href="#"><img src="https://img.shields.io/github/repo-size/power0matin/discord-twitch-kick-stream-notifier?style=flat&labelColor=333333&logoColor=E7E7E7&color=007BFF&label=Repo%20Size&logo=github" alt="Repo size badge" /></a>
</p>

<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen"/></a>
  <a href="#"><img src="https://img.shields.io/badge/License-MIT-yellow.svg"/></a>
  <a href="#"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg"/></a>
  <a href="#"><img src="https://img.shields.io/badge/Discord-Bot-5865F2"/></a>
</p>

A **Discord bot** that monitors **Twitch** and **Kick** streams and posts **LIVE alerts + stream links** when streams match your filters.

> Designed for reliable curated monitoring (streamer lists) with optional discovery mode for advanced usage.

## Highlights

### Default (GTA RP-ready)

- **Game/Category** must be **Grand Theft Auto V** (configurable)
- **Title** must match a **keyword/regex**
  - Default: `nox\\s*rp`

### What you get

- Monitors **Twitch** + **Kick**
- Filters by **Game/Category** + **Title regex**
- Posts alerts to a notify channel with:
  - `@here` (toggleable)
  - Optional **Discord user mention** per streamer
  - Stream link
- One-message lifecycle per streamer:
  - LIVE → post alert once
  - Still LIVE → no spam
  - OFFLINE → delete prior alert
- Optional **Live Role** while streaming:
  - On LIVE → add a configured role to the streamer (based on stored `discordId`)
  - On OFFLINE (after the alert message is deleted) → remove the role
- Persistent storage via `data.json` (auto-created; gitignored)
- Health visibility (`.health`): last tick, failures, retry/backoff windows

## Table of Contents

- [Quick Start](#quick-start)
- [First-Time Setup (Recommended)](#first-time-setup-recommended)
- [Command Cheat Sheet](#command-cheat-sheet)
- [Configuration](#configuration)
- [Discord Commands](#discord-commands)
- [Permissions & Intents](#permissions--intents)
- [Deploy](#deploy)
- [Data & Storage](#data--storage)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)
- [Credits](#credits)

## Demo

### Example alert message

```text
@here 🟢 **<@DiscordUserId>** is LIVE on **Kick**
https://kick.com/amirjavankabir
```

> 🟢 Kick / 🟣 Twitch

## Quick Start

### Prerequisites

- Node.js **18+**
- Discord bot:

  - **Bot Token**
  - **Application ID (Client ID)**

- Twitch Developer App (`Client ID` + `Client Secret`) _(optional if you want Twitch)_
- Kick credentials (`Client ID` + `Client Secret`) _(optional if you want Kick)_

### Install

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/discord-twitch-kick-stream-notifier.git
cd discord-twitch-kick-stream-notifier

npm install
cp .env.example .env
```

### Configure

Edit `.env` and fill in your secrets (see [Configuration](#configuration)).

### Register Slash Commands (required for `/setup`)

```bash
node src/slash/register.js
```

Tip: For fastest iteration, set `DISCORD_GUILD_ID` in `.env` to deploy commands to one guild instantly.

### Run

```bash
node src/index.js
```

On first run, the bot will create `data.json` and begin monitoring.

> Note: `DISCORD_NOTIFY_CHANNEL_ID` is optional if you plan to configure the channel via `/setup` (recommended).

## First-Time Setup (Recommended)

After registering slash commands:

1. In your Discord server, run:

- `/setup`

2. The interactive wizard guides you through:

- Notify channel (where alerts should be posted)
- `@here` toggle
- Regex filter
- Scan interval
- Discovery mode options _(optional)_

3. Add streamers:

- via prefix commands (and optionally extend slash commands later)

## Command Cheat Sheet

### General

- `.help` — help menu
- `.config` — show current settings
- `.health` — API/backoff status + last tick info
- `.export [all|kick|twitch]` — export settings + lists (no secrets)
- `.tick` — force an immediate scan

### Settings

- `.set channel <#channel|channelId|this>`
- `.set mentionhere <on|off>`
- `.set regex <pattern>`
- `.set interval <seconds>` (10..3600)
- `.set discovery <on|off>`
- `.set discoveryTwitchPages <1..50>`
- `.set discoveryKickLimit <1..100>`
- `.set twitchGameId <game_id>`
- `.set kickCategoryName <name>`
- `.refresh kickCategory` — force re-resolve Kick category id

### Kick list

- Add:

  - `.k add <kickSlug> [@discordUser|discordUserId]`
  - Shortcut: `.k <kickSlug> [@discordUser|discordUserId]`

- Remove: `.k remove <kickSlug>`
- List: `.k list`
- Status (debug): `.k status <kickSlug>`
- Bulk add: `.k addmany <slug1> <slug2> ...`
- Set/clear mention: `.k setmention <kickSlug> <@user|id|none>`
- Clear list: `.k clear --yes`

### Twitch list

- Add:

  - `.t add <twitchLogin> [@discordUser|discordUserId]`
  - Shortcut: `.t <twitchLogin> [@discordUser|discordUserId]`

- Remove: `.t remove <twitchLogin>`
- List: `.t list`
- Status (debug): `.t status <twitchLogin>`
- Bulk add: `.t addmany <login1> <login2> ...`
- Set/clear mention: `.t setmention <twitchLogin> <@user|id|none>`
- Clear list: `.t clear --yes`

## Mention support (important)

When adding a streamer, you can provide the Discord user in any of these formats:

- Real mention: `@User` (must be selected from Discord autocomplete)
- Raw ID: `123456789012345678`
- Mention markup: `<@123456789012345678>`

The bot stores the Discord user ID and uses it in alert messages.

Tip: If you typed `@username` but didn’t select the user from autocomplete, it might not be a real mention. Using raw ID always works.

## How It Works

This bot uses a polling loop (every `CHECK_INTERVAL_SECONDS`) to:

1. Fetch live stream info for each streamer in your Kick and Twitch lists
2. Confirm the stream matches:

   - Game/Category == GTA V _(configurable)_
   - Title matches `KEYWORD_REGEX`

3. Ensure exactly one LIVE alert message exists per streamer:

   - Create if missing
   - Keep if still live
   - Delete when offline

## Configuration

This bot uses:

- Environment variables for secrets and one-time defaults
- `data.json` for persistent runtime settings and streamer lists

On first run, env vars are copied into `data.json` as defaults.
After that, `data.json` is treated as the source of truth (so you can change settings via Discord commands), unless you enable legacy overwrite mode.

### Credentials (official links)

Discord Developer Portal (create app, get Token, get Client ID):
[https://discord.com/developers/applications](https://discord.com/developers/applications)

Twitch - Register your app (Client ID / Secret):
[https://dev.twitch.tv/docs/authentication/register-app](https://dev.twitch.tv/docs/authentication/register-app)
Twitch Developer Console:
[https://dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps)

Kick credentials depend on your Kick developer access/process. Fill `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET` as provided for your app.

### Required

| Variable               | Description                                            |
| ---------------------- | ------------------------------------------------------ |
| `DISCORD_TOKEN`        | Your Discord bot token                                 |
| `DISCORD_CLIENT_ID`    | Discord Application ID (used to deploy slash commands) |
| `TWITCH_CLIENT_ID`     | Twitch app client ID _(required for Twitch support)_   |
| `TWITCH_CLIENT_SECRET` | Twitch app client secret _(required for Twitch)_       |
| `KICK_CLIENT_ID`       | Kick app client ID _(required for Kick support)_       |
| `KICK_CLIENT_SECRET`   | Kick app client secret _(required for Kick)_           |

### Optional (recommended)

| Variable                    | Default | Description                                                                            |
| --------------------------- | :-----: | -------------------------------------------------------------------------------------- |
| `DISCORD_NOTIFY_CHANNEL_ID` | (none)  | Notify channel ID used as a first-run default (recommended: configure via `/setup`)    |
| `DISCORD_GUILD_ID`          | (none)  | If set, slash commands deploy to that guild for instant availability                   |
| `STREAMER_LIVE_ROLE_ID`     | (none)  | Role to grant to streamers while live (requires Manage Roles + correct role hierarchy) |

### Access control

| Variable           | Description                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `ALLOWED_ROLE_IDS` | Comma-separated role IDs allowed to use admin commands. If empty, falls back to Discord **Manage Server** permission. |

### Filtering & behavior defaults

These env vars are copied into `data.json` on first run. After that, prefer changing them via Discord commands or `/setup`.

| Variable                 |              Default | Description                       |
| ------------------------ | -------------------: | --------------------------------- |
| `PREFIX`                 |                  `.` | Command prefix                    |
| `CHECK_INTERVAL_SECONDS` |                `300` | Polling interval                  |
| `MENTION_HERE`           |               `true` | Include `@here` in alerts         |
| `KEYWORD_REGEX`          |          `nox\\s*rp` | Regex used to match stream titles |
| `TWITCH_GTA5_GAME_ID`    |              `32982` | Twitch `game_id` for GTA V        |
| `KICK_GTA_CATEGORY_NAME` | `Grand Theft Auto V` | Kick category name to match       |

### Discovery mode (optional)

Discovery mode attempts to find streams without a curated list. This increases API usage and can be less reliable.

| Variable                 | Default | Description                                   |
| ------------------------ | :-----: | --------------------------------------------- |
| `DISCOVERY_MODE`         | `false` | Enable discovery scanning                     |
| `DISCOVERY_TWITCH_PAGES` |   `5`   | Twitch pages scanned (each up to 100 results) |
| `DISCOVERY_KICK_LIMIT`   |  `100`  | Kick scan limit                               |

### Settings precedence (optional)

| Variable           | Default | Description                                                                              |
| ------------------ | :-----: | ---------------------------------------------------------------------------------------- |
| `ENV_OVERRIDES_DB` | `false` | When `true`, env vars overwrite `data.json` settings on every startup (legacy behavior). |

## Discord Commands

### Permissions model

Administrative commands are restricted to roles listed in `ALLOWED_ROLE_IDS`.
If `ALLOWED_ROLE_IDS` is empty, the bot falls back to allowing users with **Manage Server**.

Prefix `.help` is public.

### Slash Commands

#### `/setup`

Interactive setup wizard:

- sets notify channel
- toggles `@here`
- configures regex/interval/discovery options

If you don’t see `/setup`, check [Troubleshooting](#troubleshooting).

## Permissions & Intents

### Discord Intents (required)

- **Message Content Intent** must be enabled in Discord Developer Portal (prefix commands).
- **Server Members Intent** may be required if you use `STREAMER_LIVE_ROLE_ID` (role add/remove relies on member fetch).

### Required permissions (in notify channel)

- View Channel
- Send Messages
- Read Message History
- Mention Everyone _(required if you want `@here`)_
- Manage Messages _(required to delete the LIVE alert when the streamer goes offline)_

### Required permissions for Live Role (optional)

If using `STREAMER_LIVE_ROLE_ID`:

- Bot needs **Manage Roles**
- The configured role must be **below the bot’s highest role** in role hierarchy

### Slash commands visibility

Your bot must be invited with:

- OAuth2 scope: `applications.commands`

If you only invited it as `bot` without `applications.commands`, slash commands will not show.

## Deploy

### Option A: VPS with PM2 (recommended)

```bash
npm install
npm i -g pm2

# Register slash commands once (or whenever commands change)
node src/slash/register.js

# Run the bot
pm2 start src/index.js --name discord-twitch-kick-stream-notifier
pm2 save
pm2 startup
```

### Option B: Docker (optional template)

If you want Docker support, add a `Dockerfile` and `.dockerignore`.
PRs welcome — see [Roadmap](#roadmap).

## Data & Storage

The bot stores persistent state in `data.json`:

- Kick/Twitch streamer lists
- Mapping to Discord user IDs
- Active live messages (message IDs + session keys)
- Health/backoff state
- Runtime settings

`data.json` is intentionally in `.gitignore`.

## Troubleshooting

### Slash commands (/) do not appear

Most common causes:

1. Commands are not registered:

```bash
node src/slash/register.js
```

2. Global deploy delay (recommended: guild deploy for development)

- set `DISCORD_GUILD_ID` in `.env`
- run again:

```bash
node src/slash/register.js
```

3. Bot was not invited with `applications.commands` scope.

Reset everything (safe recovery):

```bash
node src/slash/purge-commands.js
node src/slash/register.js
node src/slash/list-commands.js
```

### Bot doesn’t respond to prefix commands

- Ensure **Message Content Intent** is enabled
- Check `PREFIX` in `.env`
- Confirm bot has permission to read/send messages in the channel

### `@here` does not ping

- Bot needs **Mention Everyone** in that channel
- Or disable via `/setup` / `.set mentionhere off`

### Live message doesn’t delete when streamer goes offline

- Bot needs **Manage Messages** in the notify channel
- If someone manually deleted the alert message, the bot treats it as deleted and updates state next scan

### Live role not assigned/removed

If using `STREAMER_LIVE_ROLE_ID`:

- Bot needs **Manage Roles**
- Role must be below bot’s highest role
- If the streamer has no stored `discordId`, role operations are skipped

### Twitch/Kick alerts not working

- Confirm `Client ID/Secret` values in `.env`
- Increase `CHECK_INTERVAL_SECONDS` (e.g., 120–180) to reduce rate limits
- Verify stream category is GTA V and title matches your regex
- Use `.k status <slug>` or `.t status <login>` to debug matching
- Use `.health` to see backoff and last errors

## FAQ

### Can I monitor a different game instead of GTA V?

Yes.

- Twitch: change `TWITCH_GTA5_GAME_ID`
- Kick: change `KICK_GTA_CATEGORY_NAME`

### Can I monitor multiple keywords?

Yes. Example:

- `KEYWORD_REGEX=(nox\\s*rp|my\\s*event|tournament)`

### Can I run it in multiple Discord servers?

Not yet out-of-the-box. See [Roadmap](#roadmap).

## Roadmap

- [ ] Multi-server configuration (per-guild settings & channels)
- [ ] Docker support
- [x] Slash commands (Discord interactions)
- [ ] Expand slash commands beyond `/setup` (add/list/remove streamers, health, config)
- [ ] Web dashboard (optional)
- [ ] Webhook/event-driven alerts where possible
- [ ] Additional platforms (YouTube, Trovo, etc.)

## Contributing

Contributions are welcome.

1. Fork the repo
2. Create a branch:

```bash
git checkout -b feat/my-feature
```

3. Commit using clear messages:

```bash
git commit -m "feat: add ..."
```

4. Push and open a Pull Request

Guidelines:

- Never commit `.env`, tokens, or secrets
- Keep changes focused and documented
- Update README if behavior changes

## Security

If you discover a security issue, please do not open a public issue.
Create a private report or contact the maintainer.

See: [SECURITY.md](SECURITY.md)

## License

MIT — see [LICENSE](LICENSE)

## Credits

Built with:

- [discord.js](https://discord.js.org/)
- Twitch Helix API
- Kick API
