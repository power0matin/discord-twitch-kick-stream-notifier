# FiveM Discord Manager Bot

<p align="center">
  <a href="#"><img src="https://badges.strrl.dev/visits/power0matin/fivem-discord-manager-bot?style=flat&labelColor=333333&logoColor=E7E7E7&label=Visits&logo=github" alt="Visits badge" /></a>
  <a href="#"><img src="https://img.shields.io/github/stars/power0matin/fivem-discord-manager-bot?style=flat&labelColor=333333&logoColor=E7E7E7&color=EEAA00&label=Stars&logo=github" alt="Stars badge" /></a>
  <a href="#"><img src="https://img.shields.io/github/repo-size/power0matin/fivem-discord-manager-bot?style=flat&labelColor=333333&logoColor=E7E7E7&color=007BFF&label=Repo%20Size&logo=github" alt="Repo size badge" /></a>
</p>

<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen"/></a>
  <a href="#"><img src="https://img.shields.io/badge/discord.js-v14-5865F2"/></a>
  <a href="#"><img src="https://img.shields.io/badge/License-MIT-yellow.svg"/></a>
  <a href="#"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg"/></a>
</p>

A **modular Discord bot** for **FiveM communities**.

It currently ships with:

- **Stream Notifier** (Twitch + Kick alerts with filters)
- **FiveM Server Status** (auto-updating status card with players, restart ETA, optional server uptime, and buttons)
- **Tickets** (panel + private ticket channels + close workflow)
- **Welcome** (clean welcome message with buttons + user avatar thumbnail)

Designed for reliability, rate-limit safety, and clean UX.

## Table of Contents

- [Modules](#modules)
- [Quick Start](#quick-start)
- [Slash Commands](#slash-commands)
- [Configuration](#configuration)
- [Data & Storage](#data--storage)
- [Permissions & Intents](#permissions--intents)
- [Deploy](#deploy)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Modules

### 1) Stream Notifier (Twitch + Kick)

Monitors Twitch and Kick streams and posts **LIVE alerts + links** when streams match:

- **Game/Category** (default GTA V; configurable)
- **Title keyword/regex** (default: `nox\s*[-_]*\s*rp`)

Key behaviors:

- One-message lifecycle per streamer (LIVE -> create once, still LIVE -> no spam, OFFLINE -> delete)
- Optional `@here` mention (toggleable)
- Optional stored Discord mention per streamer
- Persistent state and health/backoff status

### 2) FiveM Status

Auto-posts (or edits) a single **status card** message in a configured channel.

What it shows:

- Online/offline (with blocked endpoint detection: `"Nope."`)
- Players count (+ optional players list, safe/truncated)
- **F8 connect command** (configurable)
- **Next restart ETA** (based on daily restart times you set)
- **Uptime (STRICT)**: shown **only if the FiveM server explicitly publishes uptime**
  - If the server does not expose uptime via `/dynamic.json` or `/info.json` (including `vars`), the embed shows `--`
  - This prevents showing bot-observed uptime (which is often misleading)

Buttons / UX:

- **Website button** (http/https link button)
- **Connect button**
  - If `connectUrl` is **http/https** → Discord link button
  - If `connectUrl` is **fivem://...** → custom button that replies ephemerally with connect instructions + the link

Data sources (FiveM endpoints):

- `/dynamic.json` (primary signal in most setups)
- `/info.json`
- `/players.json`

Reliability behaviors:

- Edits a single message in-place (no channel spam)
- Failure backoff to avoid hammering on transient outages

### 3) Tickets

Ticket system designed for FiveM communities:

- Create/update **ticket panel** message with a button
- Private ticket channels under a category
- Staff role access
- Close workflow with confirm/cancel
- Optional log channel

### 4) Welcome

Welcome module sends a clean message when someone joins.

**Important UX requirement (implemented):**

- Mention is NOT inside the embed
- The message content is ONLY: `||@mention||`
- Under it, an embed is posted with:
  - Thumbnail = user avatar
  - Title + description (no mention)
  - Two link buttons (e.g., Rules, Website)

## Quick Start

### Prerequisites

- Node.js **18+**
- A Discord application/bot:
  - **Bot Token**
  - **Application ID (Client ID)**

Optional (only if you want the Stream Notifier module fully working):

- Twitch Developer App: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`
- Kick credentials: `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET`

### Install

```bash
git clone https://github.com/power0matin/fivem-discord-manager-bot.git
cd fivem-discord-manager-bot

npm install
cp .env.example .env
```

### Register Slash Commands (recommended for fast iteration)

```bash
npm run slash:register
```

Tip: Set `DISCORD_GUILD_ID` in `.env` to register commands to a single guild instantly.

### Run

```bash
npm run start
```

On first run, the bot will create `data.json` and use `.env` to seed defaults.

## Slash Commands

### `/setup` (Stream Notifier)

Interactive wizard for Stream Notifier module:

- notify channel
- `@here`
- regex filter
- scan interval
- discovery options (optional)

### `/fivem`

FiveM server status & auto updater:

Core:

- `/fivem set-endpoint url:http://127.0.0.1:30120`
- `/fivem set-channel channel:#status`
- `/fivem set-interval seconds:300`
- `/fivem toggle enabled:true`
- `/fivem status`
- `/fivem show`

UI / Card:

- `/fivem set-title title:"Nox RP v3.1"`
- `/fivem set-description text:"Short tagline here..."`
- `/fivem set-banner url:"https://..."` or `/fivem set-banner clear:true`

Buttons / Connect UX:

- `/fivem set-website url:"https://example.com" label:"Website"`
- `/fivem set-connect url:"fivem://connect/your.host"` or `url:"https://..."` + `label:"Connect"`
- `/fivem set-connect-command command:"connect your.host"`

Restart schedule:

- `/fivem set-restart-times times:"05:00,17:00"` or `/fivem set-restart-times clear:true`

### `/tickets`

Ticket system management:

- `/tickets toggle enabled:true`
- `/tickets set-category category:<category>`
- `/tickets staff-add role:<role>`
- `/tickets set-log-channel channel:<channel>`
- `/tickets panel channel:<channel> [title] [description]`
- `/tickets close` (inside ticket channel)
- `/tickets show`

### `/welcome`

Welcome system:

- `/welcome toggle enabled:true`
- `/welcome set-channel channel:#welcome`
- `/welcome set-title title:"Welcome to the NOX Community!"`
- `/welcome set-message template:"Welcome to the NOX Community! We are glad to have you."`
- `/welcome set-buttons label1:"Rules" url1:"https://..." label2:"Website" url2:"https://..."`
- `/welcome test`
- `/welcome show`

## Configuration

This bot uses:

- `.env` for secrets and first-run defaults
- `data.json` for persistent runtime config/state

After first run, **`data.json` is the source of truth** so you can configure via Discord commands without redeploying.

### Required

| Variable            | Description                |
| ------------------- | -------------------------- |
| `DISCORD_TOKEN`     | Discord bot token          |
| `DISCORD_CLIENT_ID` | Application ID (Client ID) |

### Optional (recommended)

| Variable           | Description                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `DISCORD_GUILD_ID` | If set, registers slash commands to this guild (instant)                                          |
| `ALLOWED_ROLE_IDS` | Comma-separated role IDs allowed to use admin commands. If empty, falls back to **Manage Server** |

### Stream Notifier (optional per platform)

| Variable               | Description      |
| ---------------------- | ---------------- |
| `TWITCH_CLIENT_ID`     | Twitch client id |
| `TWITCH_CLIENT_SECRET` | Twitch secret    |
| `KICK_CLIENT_ID`       | Kick client id   |
| `KICK_CLIENT_SECRET`   | Kick secret      |

## Data & Storage

`data.json` stores:

- Stream Notifier settings + streamer lists
- FiveM status card settings (buttons, restart schedule, embed theme) + module backoff/health state
- Tickets settings + open ticket mappings
- Welcome settings (templates/buttons/roles)
- Message IDs for edit-in-place behavior (FiveM status / Stream alerts)

`data.json` is intentionally gitignored.

## Permissions & Intents

### Discord intents

- **Message Content Intent**: required if you use prefix commands (legacy stream-notifier features)
- **Server Members Intent**: recommended for welcome/roles and any role assignment features

### Required permissions (recommended baseline)

- View Channel
- Send Messages
- Embed Links
- Read Message History

Module-specific:

- **Tickets**: Manage Channels, Manage Messages (delete/close), View Channels
- **Stream Notifier**: Manage Messages (delete live alert on offline), Mention Everyone (if using `@here`)
- **Welcome**: Send Messages, Embed Links, (optional) Manage Roles (auto-role)

## Deploy

### Option A: PM2 (recommended)

```bash
npm i -g pm2

# slash commands (run when commands change)
npm run slash:register

pm2 start src/index.js --name fivem-discord-manager-bot
pm2 save
pm2 startup
```

### Option B: Docker

Not included yet. PRs welcome.

## Troubleshooting

### Slash commands do not appear

1. Ensure you registered them:

```bash
npm run slash:register
```

2. If using global deploy, wait (can take time). For development use guild deploy:

- set `DISCORD_GUILD_ID` in `.env`

3. Ensure bot invite includes:

- scope: `applications.commands`
- scope: `bot`

Reset commands (safe recovery):

```bash
npm run slash:purge
npm run slash:register
npm run slash:list
```

### Welcome message has no buttons

Buttons are link buttons; they require URLs to be set:

- `/welcome set-buttons ...`
  or set them in `data.json` under `welcome.settings.buttons`.

### Tickets cannot create channels

Ensure bot has:

- Manage Channels
- View Channels
- Send Messages
  Also ensure ticket category is a valid category.

### FiveM uptime shows `--`

This is expected in **STRICT uptime mode**.

The bot only displays uptime if your FiveM server explicitly publishes it via `/dynamic.json` or `/info.json` (including `vars`).
If your server does not expose an uptime variable/convar, the embed shows `--` to avoid misleading “bot uptime”.

Tip:

- Expose a convar/variable like `uptimeSeconds` (or any key containing `uptime`) on the server side so it appears under `vars`.
- Then the bot can parse and render it.

### FiveM endpoints are blocked (shows Offline / “Nope.”)

If the bot reports that endpoints are blocked, your server (or a proxy/firewall) is likely returning `"Nope."` for:

- `/dynamic.json`
- `/info.json`
- `/players.json`

Ensure the bot host can reach your FiveM server port (default `30120`) and that these endpoints are not filtered.

## Roadmap

- [ ] Convert to a true top-level modular core (single client in `src/index.js`, modules register on it)
- [ ] Multi-server configuration (per-guild data)
- [ ] Docker support
- [ ] Expand slash commands for Stream Notifier streamer management
- [ ] More FiveM utilities (server rules sync, whitelist tools, moderation helpers)

## Contributing

PRs are welcome.

- Keep changes small and reviewable
- Never commit `.env` or tokens
- Update README if behavior changes

See: [CONTRIBUTING.md](CONTRIBUTING.md)

## Security

If you discover a security issue, please do not open a public issue.
See: [SECURITY.md](SECURITY.md)

## License

MIT — see [LICENSE](LICENSE)

## Contact

**Matin Shahabadi (متین شاه‌آبادی / متین شاه آبادی)**

- Website: [matinshahabadi.ir](https://matinshahabadi.ir)
- Email: [me@matinshahabadi.ir](mailto:me@matinshahabadi.ir)
- GitHub: [power0matin](https://github.com/power0matin)
- LinkedIn: [matin-shahabadi](https://www.linkedin.com/in/matin-shahabadi)
