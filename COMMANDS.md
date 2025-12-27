# Command Reference — FiveM Discord Manager Bot

This document is a practical cheat sheet for all **currently supported commands** across modules.

> Prefix commands (legacy) use `.` by default and can be changed via `PREFIX` in `.env`.  
> Slash commands are the recommended way to configure **Welcome / Tickets / FiveM / Setup**.

## Permissions Model

Administrative commands are restricted by access control:

- If `ALLOWED_ROLE_IDS` is set: only users with **at least one** of those roles can run admin commands.
- If `ALLOWED_ROLE_IDS` is empty: fallback requirement is **Manage Server** permission (`ManageGuild`).

Notes:

- Prefix `.help` may be public (depends on implementation), but most config and list management is admin-only.
- Slash commands use the same access policy.

## Quick Start (Typical Flow)

1. Register slash commands:

```bash
npm run slash:register
```

2. In Discord:

- `/setup` (Stream Notifier wizard)
- `/welcome set-channel`, `/welcome toggle enabled:true`, `/welcome set-buttons ...`
- `/tickets panel ...` (create ticket panel)
- `/fivem set-endpoint ...`, `/fivem set-channel ...`, `/fivem toggle enabled:true`

3. Run:

```bash
npm run start
```

# Slash Commands (Recommended)

## `/setup` (Stream Notifier)

Interactive setup wizard for Stream Notifier module.

What it configures (best-effort depending on your build):

- Notify channel
- `@here` toggle
- Regex filter
- Scan interval
- Discovery options (optional)

## `/welcome` — Welcome System

Welcome sends:

- Message content only: `||@mention||`
- An embed below it (no mention in embed), with user avatar thumbnail
- Two link buttons (e.g., Rules / Website)

### `/welcome toggle`

Enable/disable welcome behavior.

- `/welcome toggle enabled:true`
- `/welcome toggle enabled:false`

### `/welcome set-channel`

Set the channel where welcome messages are posted.

- `/welcome set-channel channel:#welcome`

### `/welcome set-title`

Set the embed title.

- `/welcome set-title title:"Welcome to the NOX Community!"`

### `/welcome set-message`

Set the embed description template.

Placeholders:

- `{user}` — user tag/username
- `{server}` — server name

> Mentions are stripped from embed output by design.

- `/welcome set-message template:"Welcome to {server}! We are glad to have you."`

### `/welcome set-buttons`

Configure two link buttons shown under the welcome embed.

- `/welcome set-buttons label1:"Rules" url1:"https://example.com/rules" label2:"Website" url2:"https://example.com"`

### `/welcome set-role`

Auto-role behavior for new members.

- Set role:

  - `/welcome set-role role:@Member`

- Clear:

  - `/welcome set-role clear:true`

### `/welcome set-dm`

Enable/disable DM and optionally set a DM template.

- Enable DM:

  - `/welcome set-dm enabled:true template:"Welcome to {server}!"`

- Disable DM:

  - `/welcome set-dm enabled:false`

### `/welcome test`

Sends a test welcome (best-effort).
In most builds, test can **force send** even if welcome is disabled (to validate formatting).

- `/welcome test`

### `/welcome show`

Show current welcome settings.

- `/welcome show`

## `/tickets` — Ticket System

Ticket module provides:

- A panel message with a “Create Ticket” button
- Private ticket channels under a category
- Staff role access
- Close workflow (button + confirmation)
- Optional logging

### `/tickets toggle`

Enable/disable ticket system.

- `/tickets toggle enabled:true`
- `/tickets toggle enabled:false`

### `/tickets set-category`

Set the category where ticket channels are created.

- `/tickets set-category category:"Tickets"`

### `/tickets staff-add` / `/tickets staff-remove`

Grant staff role access to all ticket channels.

- `/tickets staff-add role:@Staff`
- `/tickets staff-remove role:@Staff`

### `/tickets set-log-channel`

Set a log channel for ticket events (open/close).

- `/tickets set-log-channel channel:#logs`

### `/tickets panel`

Create or update the ticket panel message.

- `/tickets panel channel:#support title:"Support" description:"Open a ticket and our staff will help you."`

### `/tickets close`

Close a ticket (intended to be used inside a ticket channel).

- `/tickets close`

### `/tickets show`

Show current ticket settings.

- `/tickets show`

## `/fivem` — FiveM Server Status

FiveM module can publish or edit a live status message.

### `/fivem set-endpoint`

Set your server base URL.

Examples:

- `/fivem set-endpoint url:"http://127.0.0.1:30120"`
- `/fivem set-endpoint url:"http://YOUR_PUBLIC_IP:30120"`

> The bot typically queries endpoints like `/dynamic.json`, `/info.json`, and optionally `/players.json`.

### `/fivem set-channel`

Set the channel where the status message will be posted/updated.

- `/fivem set-channel channel:#server-status`

### `/fivem set-interval`

Set polling interval in seconds.

- `/fivem set-interval seconds:60`

### `/fivem toggle`

Enable/disable the status updater.

- `/fivem toggle enabled:true`
- `/fivem toggle enabled:false`

### `/fivem status`

Fetch status once and show the result (debug / manual check).

- `/fivem status`

### `/fivem show`

Show current FiveM settings.

- `/fivem show`

# Prefix Commands (Legacy Stream Notifier)

> These commands exist for the legacy Stream Notifier module and may be migrated to slash commands over time.

## Help

### `.help`

Shows a short list of commands in Discord.

Example:

- `.help`

## Manual Scan

### `.tick`

Runs an immediate scan (Kick + Twitch).

Example:

- `.tick`

## Health / Debug

### `.health`

Shows last tick time, failure state, backoff windows, and API health.

Example:

- `.health`

### `.config`

Shows current runtime settings (sanitized / no secrets).

Example:

- `.config`

### `.export [all|kick|twitch]`

Exports settings + lists (no secrets).

Examples:

- `.export`
- `.export kick`
- `.export twitch`

## Settings (Stream Notifier)

### `.set channel <#channel|channelId|this>`

Set the notify channel.

Examples:

- `.set channel #alerts`
- `.set channel 978674345088004126`
- `.set channel this`

### `.set mentionhere <on|off>`

Toggle `@here` in alerts.

Examples:

- `.set mentionhere on`
- `.set mentionhere off`

### `.set regex <pattern>`

Set the title filter regex.

Example:

- `.set regex nox\\s*[-_]*\\s*rp`

### `.set interval <seconds>`

Set polling interval (commonly 10..3600 depending on your build limits).

Example:

- `.set interval 60`

### `.set discovery <on|off>`

Enable discovery scanning (more API usage, less deterministic than curated lists).

Examples:

- `.set discovery on`
- `.set discovery off`

### `.set discoveryTwitchPages <1..50>`

Pages scanned on Twitch in discovery mode (each page up to 100 results).

Example:

- `.set discoveryTwitchPages 5`

### `.set discoveryKickLimit <1..100>`

Kick discovery scanning limit.

Example:

- `.set discoveryKickLimit 100`

### `.set twitchGameId <game_id>`

Set Twitch game_id used for filtering.

Example:

- `.set twitchGameId 32982`

### `.set kickCategoryName <name>`

Set Kick category name used for filtering.

Example:

- `.set kickCategoryName Grand Theft Auto V`

### `.refresh kickCategory`

Force re-resolve Kick category id.

Example:

- `.refresh kickCategory`

## Kick Commands (Admin)

### `.k list`

List configured Kick streamers.

- `.k list`

### `.k add <kickSlug> [@discordUser|discordUserId]`

Add a Kick streamer by slug.

Shortcuts:

- `.k <kickSlug> [@discordUser|discordUserId]`

Examples:

- `.k add amirjavankabir`
- `.k add amirjavankabir @Matin`
- `.k amirjavankabir 123456789012345678`

### `.k remove <kickSlug>`

Remove the streamer from the list and delete the active alert message (if any).

- `.k remove amirjavankabir`

### `.k status <kickSlug>`

Debug streamer matching: live state + filter match.

- `.k status amirjavankabir`

### Optional utilities (if present in your build)

- `.k addmany <slug1> <slug2> ...`
- `.k setmention <kickSlug> <@user|id|none>`
- `.k clear --yes`

## Twitch Commands (Admin)

### `.t list`

List configured Twitch streamers.

- `.t list`

### `.t add <twitchLogin> [@discordUser|discordUserId]`

Add a Twitch streamer by login.

Shortcut:

- `.t <twitchLogin> [@discordUser|discordUserId]`

Examples:

- `.t add shroud`
- `.t add shroud @Matin`
- `.t shroud 123456789012345678`

### `.t remove <twitchLogin>`

Remove streamer and delete active alert message (if any).

- `.t remove shroud`

### `.t status <twitchLogin>`

Debug streamer matching: live state + filter match.

- `.t status shroud`

### Optional utilities (if present in your build)

- `.t addmany <login1> <login2> ...`
- `.t setmention <twitchLogin> <@user|id|none>`
- `.t clear --yes`

## Practical Notes

### Mention formats supported

When mapping a streamer to a Discord user, supported formats typically include:

1. Real mention via autocomplete (`@User`)
2. Mention markup: `<@123>` or `<@!123>`
3. Raw numeric user ID: `123456789012345678`

Tip:
If you typed `@username` but didn’t select from autocomplete, it might not resolve as a valid mention. Raw ID always works.

### Module separation

Some commands are module-specific:

- `.` prefix commands mainly target **Stream Notifier**
- Slash commands (`/welcome`, `/tickets`, `/fivem`) target their modules

### Limitations

- Multi-server configuration (per-guild separate data) may not be included yet.
- Some options may be available only via slash commands or only via prefix commands depending on your current build.
