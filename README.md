# Discord Twitch/Kick Stream Notifier Bot

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](#prerequisites)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#license)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)
[![Discord](https://img.shields.io/badge/Discord-Bot-5865F2)](#)

A **Discord bot** that monitors **Twitch** and **Kick** streams and posts **@here alerts + stream links** when a stream matches your filters.

✅ Default behavior (ready for GTA RP servers):

- Stream **Game/Category** must be **Grand Theft Auto V**
- Stream **Title** must match a **keyword/regex** (default: `nox\\s*rp`)

This project is designed to be **global** and **configurable** — track any keyword (RP, tournaments, events, etc.) with curated streamer lists for reliable monitoring.

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Demo](#demo)
- [Quick Start](#quick-start)
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

## Features

- ✅ Monitors **Twitch** + **Kick**
- ✅ **Keyword/Regex filtering** on stream titles (`KEYWORD_REGEX`)
- ✅ **GTA V only** filtering (configurable)
- ✅ Sends alerts to a specific Discord channel:
  - `@here` (toggleable)
  - **Streamer Discord mention** (optional, saved when adding streamers)
  - Stream link
- ✅ Curated streamer lists:
  - Kick list (`.k add/remove/list`)
  - Twitch list (`.t add/remove/list`)
- ✅ Persistent storage via `data.json` (auto-created; ignored by git)
- ✅ **Live message lifecycle**
  - When streamer goes LIVE → bot posts an alert
  - While still LIVE → message stays (no spam)
  - When streamer goes OFFLINE → bot deletes the previous alert message
- ✅ Resilient tracking: if the alert message was deleted manually, the bot recreates it on the next scan

Optional (advanced):

- 🔎 Discovery mode: scan public listings for matching streams (higher API usage; less reliable on Kick due to listing limits)

## How It Works

This bot uses a **polling loop** (every `CHECK_INTERVAL_SECONDS`) to:

1. Fetch live stream info for each streamer in your **Kick** and **Twitch** lists
2. Confirm the stream matches:
   - **Game/Category == GTA V**
   - **Title matches KEYWORD_REGEX**
3. Ensure a single "LIVE" alert message exists:
   - Create if missing
   - Keep if still live
   - Delete when offline

## Demo

### Example alert message

```text
@here 🟢 **<@DiscordUserId>** is LIVE on **Kick**
https://kick.com/amirjavankabir
```

> 🟢 Kick / 🟣 Twitch

### Command style example

```text
.k add amirjavankabir @AmirJavan
✅ | Streamer amirjavankabir added to Kick list. (ID: 917523060733644840)

.t add miinaaw 857045672989818892
✅ | Streamer miinaaw added to Twitch list. (ID: 857045672989818892)
```

### Mention support (important)

When adding a streamer, you can provide the Discord user in **any** of these formats:

- real mention: `@User`
- raw ID: `123456789012345678`
- mention markup: `<@123456789012345678>`

The bot saves the Discord user ID and will mention them in every alert.

> Tip: If you typed `@username` but didn’t select the user from the Discord autocomplete, it may not be a real mention. Using the raw ID always works.

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

This bot uses a mix of:

- **Environment variables** for secrets and one-time defaults
- **data.json** (persistent DB) for runtime settings and streamer lists

On first run, env vars are copied into `data.json` as defaults.
After that, the bot treats `data.json` as the source of truth (so you can change settings via Discord commands) unless you enable legacy overwrite mode.

### Required

| Variable                    | Description                            |
| --------------------------- | -------------------------------------- |
| `DISCORD_TOKEN`             | Your Discord bot token                 |
| `DISCORD_NOTIFY_CHANNEL_ID` | Channel ID where alerts will be posted |
| `TWITCH_CLIENT_ID`          | Twitch app client ID                   |
| `TWITCH_CLIENT_SECRET`      | Twitch app client secret               |
| `KICK_CLIENT_ID`            | Kick app client ID                     |
| `KICK_CLIENT_SECRET`        | Kick app client secret                 |

### Access control

| Variable           | Description                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ALLOWED_ROLE_IDS` | Comma-separated Discord role IDs allowed to use admin commands. If empty, the bot falls back to Discord **Manage Server** permission. |

### Filtering & behavior (defaults)

These env vars are treated as **defaults** and are copied into `data.json` on first run.
After that, you should prefer changing them via Discord commands (see [Discord Commands](#discord-commands)).

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

### Settings precedence (optional)

| Variable           | Default | Description                                                                              |
| ------------------ | ------: | ---------------------------------------------------------------------------------------- |
| `ENV_OVERRIDES_DB` | `false` | When `true`, env vars overwrite `data.json` settings on every startup (legacy behavior). |

## Discord Commands

### Permissions

Administrative commands are restricted to roles listed in `ALLOWED_ROLE_IDS` (comma-separated).
If `ALLOWED_ROLE_IDS` is empty, the bot falls back to allowing users with **Manage Server**.

`.help` is public.

### General

- `.config` — show current settings
- `.health` — API/backoff status + last tick info
- `.export [all|kick|twitch]` — export settings + lists (no secrets)
- `.tick` — forces an immediate scan

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
  - shortcut: `.k <kickSlug> [@discordUser|discordUserId]`

- Remove:

  - `.k remove <kickSlug>`

- List:

  - `.k list`

- Status (debug):

  - `.k status <kickSlug>`

- Bulk add:

  - `.k addmany <slug1> <slug2> ...`

- Set/clear Discord mention:

  - `.k setmention <kickSlug> <@user|id|none>`

- Clear list:

  - `.k clear --yes`

### Twitch list

- Add:

  - `.t add <twitchLogin> [@discordUser|discordUserId]`
  - shortcut: `.t <twitchLogin> [@discordUser|discordUserId]`

- Remove:

  - `.t remove <twitchLogin>`

- List:

  - `.t list`

- Status (debug):

  - `.t status <twitchLogin>`

- Bulk add:

  - `.t addmany <login1> <login2> ...`

- Set/clear Discord mention:

  - `.t setmention <twitchLogin> <@user|id|none>`

- Clear list:

  - `.t clear --yes`

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
- **Manage Messages** _(required to delete the LIVE alert when the streamer goes offline)_

## Deploy

### Option A: VPS with PM2 (recommended)

```bash
npm install
npm i -g pm2

pm2 start index.js --name discord-twitch-kick-stream-notifier
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
  - active live messages (message IDs + session keys)

`data.json` is intentionally in `.gitignore`.

## Troubleshooting

### Bot doesn’t respond to commands

- Ensure **Message Content Intent** is enabled
- Check `PREFIX` in `.env`
- Confirm the bot has permission to read/send messages in the channel

### `@here` does not ping

- The bot needs the **Mention Everyone** permission in that channel
- Or set `MENTION_HERE=false` to disable mentions

### Live message doesn’t delete when streamer goes offline

- The bot needs **Manage Messages** in the notify channel
- If you changed the notify channel ID, restart the bot
- If someone manually deleted the alert message, the bot will recreate it next scan

### Twitch/Kick alerts not working

- Confirm `Client ID/Secret` values in `.env`
- Increase `CHECK_INTERVAL_SECONDS` (e.g., 120–180) to reduce rate limits
- Verify the stream is actually in **GTA V** category and the title matches your regex
- Use `.k status <slug>` or `.t status <login>` to debug matching

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
