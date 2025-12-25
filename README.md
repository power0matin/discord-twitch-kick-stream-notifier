# Discord Twitch/Kick Stream Notifier Bot

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](#prerequisites)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#license)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)
[![Discord](https://img.shields.io/badge/Discord-Bot-5865F2)](#)

A **Discord bot** that monitors **Twitch** and **Kick** streams and posts **@here alerts + stream links** when a stream matches your filters.

✅ Default behavior (ready for GTA RP servers):

- Stream **Game/Category** must be **Grand Theft Auto V**
- Stream **Title** must match a **keyword/regex** (default: `Nox RP` style pattern)

This project is designed to be **global** and **configurable** — you can track any keyword (RP, tournaments, events, etc.), and optionally maintain curated streamer lists for reliable monitoring.

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Demo](#demo)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Discord Commands](#discord-commands)
- [Permissions & Intents](#permissions--intents)
- [Deploy](#deploy)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)
- [Credits](#credits)

## Features

- ✅ Monitors **Twitch** + **Kick**
- ✅ **Keyword/Regex filtering** on stream titles (default regex supports `nox rp` variations)
- ✅ **GTA V only** filtering (configurable)
- ✅ Sends alerts to a specific Discord channel:
  - `@here` (toggleable)
  - Stream link
  - Optional mention of the related Discord user (if provided in the list)
- ✅ Curated streamer lists:
  - Kick list (`.k add/remove/list`)
  - Twitch list (`.t add/remove/list`)
- ✅ Anti-spam: one alert per stream session (tracks last announced stream IDs)
- ✅ Persistent storage via `data.json` (auto-created; ignored by git)

Optional (advanced):

- 🔎 Discovery mode: scan public listings for matching streams (higher API usage, less reliable on Kick due to listing limits)

## How It Works

This bot uses a **polling loop** (every `CHECK_INTERVAL_SECONDS`) to:

1. Fetch live stream info for each streamer in your **Kick** and **Twitch** lists
2. Confirm the stream matches:
   - **Game/Category == GTA V**
   - **Title matches KEYWORD_REGEX**
3. Post an alert message to your Discord channel and optionally ping `@here`

> Polling is simple, reliable, and works well for communities. If you want event-driven alerts later, see the [Roadmap](#roadmap).

## Demo

### Example alert message

```text
@here <@DiscordUserId> 🔴 **lionkiiing** is LIVE on **Kick**
🎮 **Grand Theft Auto V**
📝 Nox RP | ...
https://kick.com/lionkiiing
```

### Command style example

```text
.k add lionkiiing @Lion King
✅ | Streamer lionkiiing added to Kick list. (ID: 511913973302689802)

.t add rikoczq @Riko
✅ | Streamer rikoczq added to Twitch list. (ID: 580077760102531123)
```

> Want screenshots/GIFs here? Add files to `/assets` and update the links below.

#### Screenshot placeholders

- `assets/alert.png`
- `assets/commands.png`

```md
![Alert Screenshot](assets/alert.png)
![Commands Screenshot](assets/commands.png)
```

## Quick Start

### Prerequisites

- Node.js **18+**
- A Discord Bot Token
- Twitch Developer App (`Client ID` + `Client Secret`)
- Kick Developer App (`Client ID` + `Client Secret`)

### Install

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/discord-twitch-kick-stream-notifier-bot.git
cd discord-twitch-kick-stream-notifier-bot

npm install
cp .env.example .env
```

### Configure

Edit `.env` and fill in your secrets (see [Configuration](#configuration)).

### Run

```bash
npm start
```

On first run, the bot will create `data.json` and begin monitoring.

## Configuration

All settings are controlled via environment variables.

### Required

| Variable                    | Description                            |
| --------------------------- | -------------------------------------- |
| `DISCORD_TOKEN`             | Your Discord bot token                 |
| `DISCORD_NOTIFY_CHANNEL_ID` | Channel ID where alerts will be posted |
| `TWITCH_CLIENT_ID`          | Twitch app client ID                   |
| `TWITCH_CLIENT_SECRET`      | Twitch app client secret               |
| `KICK_CLIENT_ID`            | Kick app client ID                     |
| `KICK_CLIENT_SECRET`        | Kick app client secret                 |

### Filtering & behavior

| Variable                 |              Default | Description                       |
| ------------------------ | -------------------: | --------------------------------- |
| `PREFIX`                 |                  `.` | Command prefix                    |
| `CHECK_INTERVAL_SECONDS` |                 `60` | Polling interval                  |
| `MENTION_HERE`           |               `true` | Include `@here` in alerts         |
| `KEYWORD_REGEX`          |          `nox\\s*rp` | Regex used to match stream titles |
| `TWITCH_GTA5_GAME_ID`    |              `32982` | Twitch game_id for GTA V          |
| `KICK_GTA_CATEGORY_NAME` | `Grand Theft Auto V` | Kick category name to match       |

### Discovery mode (optional)

> Discovery mode attempts to find streams without a curated list.
> This can increase API usage and may be less reliable (especially on Kick due to listing constraints).

| Variable                 | Default | Description                                      |
| ------------------------ | ------: | ------------------------------------------------ |
| `DISCOVERY_MODE`         | `false` | Enable discovery scanning                        |
| `DISCOVERY_TWITCH_PAGES` |     `5` | Pages scanned on Twitch (each up to 100 results) |
| `DISCOVERY_KICK_LIMIT`   |   `100` | Kick scan limit                                  |

## Discord Commands

> Admin requirement: Users must have **Manage Server** permission to run commands (the bot enforces this).

### Kick list

- Add:

  - `.k add <kickSlug> [@discordUser]`
  - shortcut: `.k <kickSlug> [@discordUser]`

- Remove:

  - `.k remove <kickSlug>`

- List:

  - `.k list`

### Twitch list

- Add:

  - `.t add <twitchLogin> [@discordUser]`
  - shortcut: `.t <twitchLogin> [@discordUser]`

- Remove:

  - `.t remove <twitchLogin>`

- List:

  - `.t list`

### Manual check

- `.tick` — forces an immediate scan

### Help

- `.help`

## Permissions & Intents

### Discord Intent (required)

Enable **Message Content Intent** in Discord Developer Portal (because this bot uses prefix commands).

### Discord permissions (in your alert channel)

The bot should have:

- View Channel
- Send Messages
- Read Message History
- **Mention Everyone** _(required if you want `@here` to actually ping)_

## Deploy

### Option A: VPS with PM2 (recommended)

```bash
# install deps
npm install

# install pm2 globally
npm i -g pm2

# run
pm2 start src/index.js --name discord-twitch-kick-stream-notifier
pm2 save
pm2 startup
```

### Option B: Docker (optional template)

If you want Docker support, add a `Dockerfile` and `.dockerignore`.
(PRs welcome — see [Roadmap](#roadmap).)

## Data & Storage

- The bot stores persistent state in `data.json`:

  - kick/twitch streamer lists
  - mapping to Discord user IDs
  - last announced stream IDs (anti-spam)

`data.json` is intentionally in `.gitignore`.

## Troubleshooting

### Bot doesn’t respond to commands

- Ensure **Message Content Intent** is enabled
- Check `PREFIX` in `.env`
- Confirm the bot has permission to read/send messages in the channel

### `@here` does not ping

- The bot needs the **Mention Everyone** permission in that channel
- Or set `MENTION_HERE=false` to disable mentions

### Twitch/Kick alerts not working

- Confirm `Client ID/Secret` values in `.env`
- Increase `CHECK_INTERVAL_SECONDS` (e.g., 120–180) to reduce rate limits
- Verify the stream is actually in **GTA V** category and the title matches your regex

## FAQ

### Can I monitor a different game instead of GTA V?

Yes.

- Twitch: change `TWITCH_GTA5_GAME_ID`
- Kick: change `KICK_GTA_CATEGORY_NAME`

### Can I monitor multiple keywords?

Yes. Use a regex like:

- `KEYWORD_REGEX=(nox\\s*rp|my\\s*event|tournament)`

### Can I run it in multiple Discord servers?

Not yet out-of-the-box. See [Roadmap](#roadmap).

## Roadmap

- [ ] Multi-server configuration (per-guild settings & channels)
- [ ] Docker support
- [ ] Slash commands (Discord interactions)
- [ ] Web dashboard (optional)
- [ ] Webhook/event-driven alerts where possible
- [ ] Additional platforms (YouTube, Trovo, etc.)

## Contributing

Contributions are welcome!

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

### Guidelines

- **Never** commit `.env`, tokens, or secrets
- Keep changes focused and documented
- Add/update README if behavior changes

## Security

If you discover a security issue, please do **not** open a public issue.
Create a private report or contact the maintainer.

See: [SECURITY.md](SECURITY.md)

## License

MIT — see [LICENSE](LICENSE)

## Credits

Built with:

- [discord.js](https://discord.js.org/)
- Twitch Helix API
- Kick API

If you use this project in a community, consider adding a ⭐ to support the repo.
