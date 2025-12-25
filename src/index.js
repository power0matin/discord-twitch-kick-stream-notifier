"use strict";

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  Events,
  ChannelType,
} = require("discord.js");

const { config } = require("./config");
const { loadDb, saveDb } = require("./storage");
const { KickClient } = require("./kick");
const { TwitchClient } = require("./twitch");

/* -------------------------- small utilities -------------------------- */

function chunkArray(arr, size) {
  if (!Array.isArray(arr) || size <= 0) return [];
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normalizeName(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

function compileRegexOrFallback(pattern, fallback = /nox\s*rp/i) {
  const p = String(pattern ?? "").trim();
  if (!p) return fallback;
  if (p.length > 200) return fallback;
  try {
    return new RegExp(p, "i");
  } catch {
    return fallback;
  }
}

function hasManageGuild(member) {
  try {
    return (
      member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild) ?? false
    );
  } catch {
    return false;
  }
}

function formatStreamerLine(i, name, discordId) {
  return discordId ? `${i}. ${name} <@${discordId}>` : `${i}. ${name}`;
}

/* ----------------------------- notifier ----------------------------- */

async function fetchNotifyChannel(client, db) {
  const channelId = db?.settings?.notifyChannelId;
  if (!channelId) return null;

  const channel = await client.channels.fetch(channelId).catch((err) => {
    console.error(
      "[Discord] Failed to fetch notify channel:",
      err?.message ?? err
    );
    return null;
  });

  if (!channel) return null;
  if (!("send" in channel)) return null;
  if (channel.type === ChannelType.DM) return null;

  return channel;
}
function extractDiscordId(message, args) {
  // 1) real mention from Discord
  const u = message?.mentions?.users?.first?.();
  if (u?.id) return u.id;

  // 2) user pasted <@123> or <@!123>
  const raw = String(message?.content ?? "");
  const m = raw.match(/<@!?(\d{17,20})>/);
  if (m?.[1]) return m[1];

  // 3) user pasted raw numeric id
  const idArg = (args || []).find((a) => /^\d{17,20}$/.test(String(a)));
  if (idArg) return String(idArg);

  return null;
}

/**
 * Sends a message and returns messageId (string) on success, null on failure.
 */
async function sendNotify(client, db, payload) {
  const channel = await fetchNotifyChannel(client, db);
  if (!channel) return null;

  const mentionHere = Boolean(db?.settings?.mentionHere);
  const everyonePing = mentionHere ? "@here " : "";

  const platform = String(payload.platform || "").toLowerCase();
  const dot = platform === "twitch" ? "🟣" : "🟢";
  const platformName = platform === "twitch" ? "Twitch" : "Kick";

  // ✅ show mention instead of username when possible
  const whoRaw = payload.discordId
    ? `<@${payload.discordId}>`
    : payload.username;
  const who = `**${whoRaw}**`;

  const msg = `${everyonePing}${dot} ${who} is LIVE on **${platformName}**\n${payload.url}`;

  const allowedMentions = {
    parse: [
      ...(mentionHere ? ["everyone"] : []),
      ...(payload.discordId ? ["users"] : []),
    ],
  };

  const sent = await channel
    .send({ content: msg, allowedMentions })
    .catch((err) => {
      console.error(
        "[Discord] Failed to send notify message:",
        err?.message ?? err
      );
      return null;
    });

  return sent?.id ?? null;
}

/**
 * Deletes an existing notification message by messageId.
 */
async function deleteNotifyMessage(client, db, messageId) {
  if (!messageId) return false;

  const channel = await fetchNotifyChannel(client, db);
  if (!channel) return false;

  if (!("messages" in channel)) return false;

  const ok = await channel.messages
    .delete(messageId)
    .then(() => true)
    .catch((err) => {
      console.error(
        "[Discord] Failed to delete notify message (need Manage Messages or message exists?):",
        err?.message ?? err
      );
      return false;
    });

  return ok;
}

/* ------------------------------ main app ----------------------------- */

async function main() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const kick = new KickClient({
    clientId: config.kick.clientId,
    clientSecret: config.kick.clientSecret,
  });

  const twitch = new TwitchClient({
    clientId: config.twitch.clientId,
    clientSecret: config.twitch.clientSecret,
  });

  let db = await loadDb();

  // Sync env -> DB
  db.settings.notifyChannelId = config.notifyChannelId;
  db.settings.mentionHere = config.mentionHere;
  db.settings.keywordRegex = config.keywordRegex;
  db.settings.twitchGta5GameId = config.twitch.gta5GameId;
  db.settings.kickGtaCategoryName = config.kick.gtaCategoryName;

  // Ensure objects exist
  db.state.kickLastAnnounced ||= {}; // legacy
  db.state.twitchLastAnnounced ||= {}; // legacy
  db.state.kickActiveMessages ||= {}; // NEW
  db.state.twitchActiveMessages ||= {}; // NEW
  db.kick.streamers ||= [];
  db.twitch.streamers ||= [];

  await saveDb(db);

  const getKeywordRegex = () =>
    compileRegexOrFallback(db.settings.keywordRegex);

  let tickRunning = false;
  let intervalHandle = null;

  // Build fast lookup maps
  const buildKickMetaMap = () => {
    const map = new Map();
    for (const s of db.kick.streamers) map.set(normalizeName(s.slug), s);
    return map;
  };
  const buildTwitchMetaMap = () => {
    const map = new Map();
    for (const s of db.twitch.streamers) map.set(normalizeName(s.login), s);
    return map;
  };

  async function ensureKickGtaCategoryId() {
    if (!kick.enabled) return null;
    if (db.settings.kickGtaCategoryId) return db.settings.kickGtaCategoryId;

    try {
      const id = await kick.findCategoryIdByName(
        db.settings.kickGtaCategoryName
      );
      db.settings.kickGtaCategoryId = id;
      await saveDb(db);
      return id;
    } catch (err) {
      console.error(
        "[Kick] Failed to resolve GTA category id:",
        err?.message ?? err
      );
      return null;
    }
  }

  /* ------------------------ Live message logic ------------------------ */
  async function notifyMessageExists(client, db, messageId) {
    if (!messageId) return false;

    const channel = await fetchNotifyChannel(client, db);
    if (!channel || !("messages" in channel)) return false;

    const msg = await channel.messages.fetch(messageId).catch(() => null);
    return Boolean(msg);
  }

  async function ensureLiveMessage(
    platformKey,
    streamerKey,
    sessionKey,
    payload
  ) {
    const stateKey =
      platformKey === "kick" ? "kickActiveMessages" : "twitchActiveMessages";
    const active = db.state[stateKey] || (db.state[stateKey] = {});

    const prev = active[streamerKey];

    // اگر session یکیه ولی پیام واقعاً وجود نداره -> دوباره بفرست
    if (prev?.sessionKey === sessionKey && prev?.messageId) {
      const exists = await notifyMessageExists(client, db, prev.messageId);
      if (exists) return false; // پیام هست، کاری نکن
      delete active[streamerKey]; // پیام نیست، state رو پاک کن تا دوباره ارسال بشه
    }

    // اگر session عوض شده و پیام قبلی داریم، حذفش کن
    if (prev?.messageId && prev?.sessionKey !== sessionKey) {
      await deleteNotifyMessage(client, db, prev.messageId);
    }

    const messageId = await sendNotify(client, db, payload);
    if (!messageId) return false;

    active[streamerKey] = { messageId, sessionKey, createdAt: Date.now() };
    return true;
  }

  async function ensureOfflineMessageDeleted(platformKey, streamerKey) {
    const stateKey =
      platformKey === "kick" ? "kickActiveMessages" : "twitchActiveMessages";
    const active = db.state[stateKey] || (db.state[stateKey] = {});
    const prev = active[streamerKey];
    if (!prev?.messageId) return false;

    await deleteNotifyMessage(client, db, prev.messageId); // اگر نشد هم مهم نیست
    delete active[streamerKey];
    return true;
  }

  /* ------------------------------- Kick ------------------------------- */

  async function checkKick() {
    if (!kick.enabled) return false;

    const gtaCategoryId = await ensureKickGtaCategoryId();
    if (!gtaCategoryId) return false;

    const keyword = getKeywordRegex();
    const slugs = db.kick.streamers
      .map((s) => normalizeName(s.slug))
      .filter(Boolean);
    if (slugs.length === 0) return false;

    const metaMap = buildKickMetaMap();
    let changed = false;

    for (const group of chunkArray(slugs, 50)) {
      let channels = [];
      try {
        channels = await kick.getChannelsBySlugs(group);
      } catch (err) {
        console.error("[Kick] API error:", err?.message ?? err);
        continue;
      }

      const processed = new Set();

      for (const ch of channels) {
        const slug = normalizeName(ch?.slug);
        if (!slug) continue;
        processed.add(slug);

        const isLive = Boolean(ch?.stream?.is_live);
        const title = String(ch?.stream_title ?? "");
        const categoryId = ch?.category?.id ?? null;
        const categoryName = String(ch?.category?.name ?? "");

        const shouldHaveMessage =
          isLive &&
          (!gtaCategoryId || categoryId == gtaCategoryId) &&
          keyword.test(title);

        if (!shouldHaveMessage) {
          const deleted = await ensureOfflineMessageDeleted("kick", slug);
          changed = changed || deleted;
          continue;
        }

        const startTime = String(ch?.stream?.start_time ?? "");
        const sessionKey =
          startTime && startTime !== "0001-01-01T00:00:00Z"
            ? startTime
            : `live:${title}`;

        const streamerMeta = metaMap.get(slug);
        const discordId = streamerMeta?.discordId ?? null;

        const created = await ensureLiveMessage("kick", slug, sessionKey, {
          platform: "Kick",
          username: slug,
          discordId,
          title,
          gameName: categoryName || "Grand Theft Auto V",
          url: `https://kick.com/${slug}`,
        });

        changed = changed || created;
      }

      // If Kick API didn't return a slug we asked for, treat it as offline
      for (const askedSlug of group) {
        if (!processed.has(askedSlug)) {
          const deleted = await ensureOfflineMessageDeleted("kick", askedSlug);
          changed = changed || deleted;
        }
      }
    }

    return changed;
  }

  async function discoverKick() {
    if (!kick.enabled || !config.discoveryMode) return false;

    const gtaCategoryId = await ensureKickGtaCategoryId();
    if (!gtaCategoryId) return false;

    const keyword = getKeywordRegex();
    const limit = Math.min(100, Number(config.discoveryKickLimit || 100));

    let lives = [];
    try {
      lives = await kick.getLivestreamsByCategoryId(
        gtaCategoryId,
        limit,
        "started_at"
      );
    } catch (err) {
      console.error("[Kick][Discover] API error:", err?.message ?? err);
      return false;
    }

    const metaMap = buildKickMetaMap();
    let changed = false;

    for (const lv of lives) {
      const slug = normalizeName(lv?.slug);
      if (!slug) continue;

      const title = String(lv?.stream_title ?? "");
      if (!keyword.test(title)) continue;

      const startedAt = String(lv?.started_at ?? "");
      const sessionKey =
        startedAt && startedAt !== "0001-01-01T00:00:00Z"
          ? startedAt
          : `live:${title}`;

      const streamerMeta = metaMap.get(slug);
      const discordId = streamerMeta?.discordId ?? null;

      const created = await ensureLiveMessage("kick", slug, sessionKey, {
        platform: "Kick",
        username: slug,
        discordId,
        title,
        gameName: String(lv?.category?.name ?? db.settings.kickGtaCategoryName),
        url: `https://kick.com/${slug}`,
      });

      changed = changed || created;
    }

    return changed;
  }

  /* ------------------------------ Twitch ------------------------------ */

  async function checkTwitch() {
    if (!twitch.enabled) return false;

    const keyword = getKeywordRegex();
    const gameId = String(db.settings.twitchGta5GameId ?? "32982");

    const logins = db.twitch.streamers
      .map((s) => normalizeName(s.login))
      .filter(Boolean);
    if (logins.length === 0) return false;

    const metaMap = buildTwitchMetaMap();
    let changed = false;

    for (const group of chunkArray(logins, 100)) {
      let streams = [];
      try {
        // Only LIVE streams returned; filtered by game_id
        streams = await twitch.getStreamsByUserLogins(group, { gameId });
      } catch (err) {
        console.error("[Twitch] API error:", err?.message ?? err);
        continue;
      }

      const liveMap = new Map();
      for (const st of streams) {
        const login = normalizeName(st?.user_login);
        if (!login) continue;
        liveMap.set(login, st);
      }

      for (const login of group) {
        const st = liveMap.get(login);

        // Not live -> delete
        if (!st) {
          const deleted = await ensureOfflineMessageDeleted("twitch", login);
          changed = changed || deleted;
          continue;
        }

        const streamId = String(st?.id ?? "");
        const title = String(st?.title ?? "");
        const gameName = String(st?.game_name ?? "Grand Theft Auto V");

        // Live but keyword doesn't match -> delete
        if (!streamId || !keyword.test(title)) {
          const deleted = await ensureOfflineMessageDeleted("twitch", login);
          changed = changed || deleted;
          continue;
        }

        const streamerMeta = metaMap.get(login);
        const discordId = streamerMeta?.discordId ?? null;

        const created = await ensureLiveMessage("twitch", login, streamId, {
          platform: "Twitch",
          username: login,
          discordId,
          title,
          gameName,
          url: `https://twitch.tv/${login}`,
        });

        changed = changed || created;
      }
    }

    return changed;
  }

  async function discoverTwitch() {
    if (!twitch.enabled || !config.discoveryMode) return false;

    const keyword = getKeywordRegex();
    const gameId = String(db.settings.twitchGta5GameId ?? "32982");
    const pages = Math.max(
      1,
      Math.min(50, Number(config.discoveryTwitchPages || 5))
    );

    let cursor = null;
    const metaMap = buildTwitchMetaMap();
    let changed = false;

    for (let page = 0; page < pages; page++) {
      let streams = [];
      try {
        const res = await twitch.getStreamsByGameId(
          gameId,
          100,
          cursor || undefined
        );
        streams = res.streams;
        cursor = res.cursor;
      } catch (err) {
        console.error("[Twitch][Discover] API error:", err?.message ?? err);
        break;
      }

      for (const st of streams) {
        const login = normalizeName(st?.user_login);
        const streamId = String(st?.id ?? "");
        const title = String(st?.title ?? "");
        const gameName = String(st?.game_name ?? "Grand Theft Auto V");

        if (!login || !streamId) continue;
        if (!keyword.test(title)) continue;

        const streamerMeta = metaMap.get(login);
        const discordId = streamerMeta?.discordId ?? null;

        const created = await ensureLiveMessage("twitch", login, streamId, {
          platform: "Twitch",
          username: login,
          discordId,
          title,
          gameName,
          url: `https://twitch.tv/${login}`,
        });

        changed = changed || created;
      }

      if (!cursor) break;
    }

    return changed;
  }

  /* ------------------------------- tick ------------------------------- */

  async function tick() {
    if (tickRunning) return { changed: false };
    tickRunning = true;

    let changed = false;
    try {
      const a = await checkKick();
      const b = await checkTwitch();
      const c = await discoverKick();
      const d = await discoverTwitch();
      changed = a || b || c || d;
    } catch (err) {
      console.error("[Tick] Unexpected error:", err?.message ?? err);
    } finally {
      if (changed) await saveDb(db).catch(() => null);
      tickRunning = false;
    }

    return { changed };
  }

  /* ----------------------------- debug/status ----------------------------- */

  async function kickStatus(slugRaw) {
    const slug = normalizeName(slugRaw);
    if (!slug) return { ok: false, msg: "Usage: .k status <kickSlug>" };

    const gtaCategoryId = await ensureKickGtaCategoryId();
    const keyword = getKeywordRegex();

    let channels = [];
    try {
      channels = await kick.getChannelsBySlugs([slug]);
    } catch (err) {
      return { ok: false, msg: `Kick API error: ${err?.message ?? err}` };
    }

    const ch = channels?.[0];
    if (!ch)
      return { ok: false, msg: `Kick channel not found for slug: ${slug}` };

    const isLive = Boolean(ch?.stream?.is_live);
    const title = String(ch?.stream_title ?? "");
    const categoryId = ch?.category?.id ?? null;
    const categoryName = String(ch?.category?.name ?? "");
    const keywordMatch = keyword.test(title);
    const gtaMatch = gtaCategoryId ? categoryId == gtaCategoryId : true;

    return {
      ok: true,
      msg:
        `**Kick Status: ${slug}**\n` +
        `Live: **${isLive ? "YES" : "NO"}**\n` +
        `Category: **${categoryName || "?"}** (id: ${categoryId ?? "?"})\n` +
        `GTA V match: **${gtaMatch ? "YES" : "NO"}**\n` +
        `Regex (${db.settings.keywordRegex}) match: **${
          keywordMatch ? "YES" : "NO"
        }**\n` +
        `Title: ${title || "(empty)"}\n` +
        `URL: https://kick.com/${slug}`,
    };
  }

  async function twitchStatus(loginRaw) {
    const login = normalizeName(loginRaw);
    if (!login) return { ok: false, msg: "Usage: .t status <twitchLogin>" };

    const keyword = getKeywordRegex();
    const gtaGameId = String(db.settings.twitchGta5GameId ?? "32982");

    // Important: call WITHOUT gameId so we can see if they're live in another category
    let streams = [];
    try {
      streams = await twitch.getStreamsByUserLogins([login], {});
    } catch (err) {
      return { ok: false, msg: `Twitch API error: ${err?.message ?? err}` };
    }

    const st = streams?.[0];
    if (!st) {
      return {
        ok: true,
        msg:
          `**Twitch Status: ${login}**\n` +
          `Live: **NO**\n` +
          `URL: https://twitch.tv/${login}`,
      };
    }

    const title = String(st?.title ?? "");
    const streamId = String(st?.id ?? "");
    const gameName = String(st?.game_name ?? "");
    const gameId = String(st?.game_id ?? "");
    const keywordMatch = keyword.test(title);
    const gtaMatch = gameId ? gameId === gtaGameId : false;

    return {
      ok: true,
      msg:
        `**Twitch Status: ${login}**\n` +
        `Live: **YES** (id: ${streamId || "?"})\n` +
        `Category: **${gameName || "?"}** (game_id: ${gameId || "?"})\n` +
        `GTA V match (expected ${gtaGameId}): **${
          gtaMatch ? "YES" : "NO"
        }**\n` +
        `Regex (${db.settings.keywordRegex}) match: **${
          keywordMatch ? "YES" : "NO"
        }**\n` +
        `Title: ${title || "(empty)"}\n` +
        `URL: https://twitch.tv/${login}`,
    };
  }

  /* ----------------------------- commands ----------------------------- */

  function replySafe(message, content) {
    return message.reply(content).catch(() => null);
  }

  client.on("messageCreate", async (message) => {
    if (!message?.guild) return;
    if (message.author?.bot) return;

    const prefix = config.prefix;
    const content = String(message.content ?? "");
    if (!content.startsWith(prefix)) return;

    const raw = content.slice(prefix.length).trim();
    if (!raw) return;

    const [cmd, ...args] = raw.split(/\s+/g);
    const cmdLower = normalizeName(cmd);

    if (cmdLower === "help") {
      const helpText = [
        "**Stream Notifier Bot Commands**",
        `\`${prefix}k list\``,
        `\`${prefix}k add <kickSlug> [@discordUser]\` (or: \`${prefix}k <kickSlug> [@user]\`)`,
        `\`${prefix}k remove <kickSlug>\``,
        `\`${prefix}k status <kickSlug>\`  (debug)`,
        "",
        `\`${prefix}t list\``,
        `\`${prefix}t add <twitchLogin> [@discordUser]\` (or: \`${prefix}t <twitchLogin> [@user]\`)`,
        `\`${prefix}t remove <twitchLogin>\``,
        `\`${prefix}t status <twitchLogin>\`  (debug)`,
        "",
        `\`${prefix}tick\` (manual scan)`,
      ].join("\n");

      await replySafe(message, helpText);
      return;
    }

    if (cmdLower === "tick") {
      if (!hasManageGuild(message.member)) {
        await replySafe(
          message,
          "❌ | You do not have **Manage Server** permission."
        );
        return;
      }

      await replySafe(message, "⏳ | Scanning Kick/Twitch ...");
      const res = await tick();

      const kickActive = Object.keys(db.state.kickActiveMessages || {}).length;
      const twitchActive = Object.keys(
        db.state.twitchActiveMessages || {}
      ).length;

      await message.channel
        .send(
          `✅ | Done. Active messages → Kick: **${kickActive}**, Twitch: **${twitchActive}**`
        )
        .catch(() => null);

      return;
    }

    // Kick commands
    if (cmdLower === "k") {
      if (!hasManageGuild(message.member)) {
        await replySafe(
          message,
          "❌ | You do not have **Manage Server** permission."
        );
        return;
      }

      const sub = normalizeName(args[0]);

      if (sub === "list") {
        if (db.kick.streamers.length === 0) {
          await replySafe(message, "🎥 | Kick Streamers List: (empty)");
          return;
        }
        const lines = db.kick.streamers
          .map((s, i) => formatStreamerLine(i + 1, s.slug, s.discordId))
          .join("\n");
        await replySafe(message, `🎥 | Kick Streamers List:\n${lines}`);
        return;
      }

      if (sub === "status") {
        const st = await kickStatus(args[1]);
        await replySafe(message, st.msg);
        return;
      }

      if (sub === "remove") {
        const slug = normalizeName(args[1]);
        if (!slug) {
          await replySafe(
            message,
            `⚠️ | Usage: \`${prefix}k remove <kickSlug>\``
          );
          return;
        }

        const before = db.kick.streamers.length;
        db.kick.streamers = db.kick.streamers.filter(
          (s) => normalizeName(s.slug) !== slug
        );
        const removed = db.kick.streamers.length !== before;

        const deleted = await ensureOfflineMessageDeleted("kick", slug);

        await saveDb(db).catch(() => null);

        if (!removed) {
          await replySafe(
            message,
            `⚠️ | Streamer ${slug} was not in Kick list.`
          );
          return;
        }

        await replySafe(
          message,
          deleted
            ? `🗑️ | Streamer ${slug} removed from Kick list and active message deleted.`
            : `🗑️ | Streamer ${slug} removed from Kick list.`
        );
        return;
      }

      // add mode: `.k add <slug> [@user]` OR `.k <slug> [@user]`
      const isAdd = sub === "add";
      const slug = normalizeName(isAdd ? args[1] : args[0]);

      if (!slug || ["list", "remove", "add", "status"].includes(slug)) {
        await replySafe(
          message,
          `⚠️ | Usage: \`${prefix}k add <kickSlug> [@user]\``
        );
        return;
      }

      const discordId = extractDiscordId(message, args);

      const exists = db.kick.streamers.some(
        (s) => normalizeName(s.slug) === slug
      );
      if (exists) {
        await replySafe(
          message,
          `⚠️ | Streamer ${slug} is already in Kick list.`
        );
        return;
      }

      db.kick.streamers.push({ slug, discordId });
      await saveDb(db).catch(() => null);

      await replySafe(
        message,
        discordId
          ? `✅ | Streamer ${slug} added to Kick list. (ID: ${discordId})`
          : `✅ | Streamer ${slug} added to Kick list.`
      );
      return;
    }

    // Twitch commands
    if (cmdLower === "t") {
      if (!hasManageGuild(message.member)) {
        await replySafe(
          message,
          "❌ | You do not have **Manage Server** permission."
        );
        return;
      }

      const sub = normalizeName(args[0]);

      if (sub === "list") {
        if (db.twitch.streamers.length === 0) {
          await replySafe(message, "🎥 | Twitch Streamers List: (empty)");
          return;
        }
        const lines = db.twitch.streamers
          .map((s, i) => formatStreamerLine(i + 1, s.login, s.discordId))
          .join("\n");
        await replySafe(message, `🎥 | Twitch Streamers List:\n${lines}`);
        return;
      }

      if (sub === "status") {
        const st = await twitchStatus(args[1]);
        await replySafe(message, st.msg);
        return;
      }

      if (sub === "remove") {
        const login = normalizeName(args[1]);
        if (!login) {
          await replySafe(
            message,
            `⚠️ | Usage: \`${prefix}t remove <twitchLogin>\``
          );
          return;
        }

        const before = db.twitch.streamers.length;
        db.twitch.streamers = db.twitch.streamers.filter(
          (s) => normalizeName(s.login) !== login
        );
        const removed = db.twitch.streamers.length !== before;

        const deleted = await ensureOfflineMessageDeleted("twitch", login);

        await saveDb(db).catch(() => null);

        if (!removed) {
          await replySafe(
            message,
            `⚠️ | Streamer ${login} was not in Twitch list.`
          );
          return;
        }

        await replySafe(
          message,
          deleted
            ? `🗑️ | Streamer ${login} removed from Twitch list and active message deleted.`
            : `🗑️ | Streamer ${login} removed from Twitch list.`
        );
        return;
      }

      const isAdd = sub === "add";
      const login = normalizeName(isAdd ? args[1] : args[0]);

      if (!login || ["list", "remove", "add", "status"].includes(login)) {
        await replySafe(
          message,
          `⚠️ | Usage: \`${prefix}t add <twitchLogin> [@user]\``
        );
        return;
      }

      const discordId = extractDiscordId(message, args);

      const exists = db.twitch.streamers.some(
        (s) => normalizeName(s.login) === login
      );
      if (exists) {
        await replySafe(
          message,
          `⚠️ | Streamer ${login} is already in Twitch list.`
        );
        return;
      }

      db.twitch.streamers.push({ login, discordId });
      await saveDb(db).catch(() => null);

      await replySafe(
        message,
        discordId
          ? `✅ | Streamer ${login} added to Twitch list. (ID: ${discordId})`
          : `✅ | Streamer ${login} added to Twitch list.`
      );
      return;
    }
  });

  /* ----------------------------- lifecycle ----------------------------- */

  client.once(Events.ClientReady, async (c) => {
    console.log("[Config] notifyChannelId:", db.settings.notifyChannelId);
    console.log("[Config] Kick enabled:", kick.enabled);
    console.log("[Config] Twitch enabled:", twitch.enabled);
    console.log("[Config] KEYWORD_REGEX:", db.settings.keywordRegex);
    console.log("[Config] Twitch GTA5 GameId:", db.settings.twitchGta5GameId);
    console.log(
      "[Config] Kick GTA Category Name:",
      db.settings.kickGtaCategoryName
    );

    console.log(`Logged in as ${c.user.tag}`);

    await tick();

    const intervalMs =
      Math.max(10, Number(config.checkIntervalSeconds || 60)) * 1000;
    if (intervalHandle) clearInterval(intervalHandle);
    intervalHandle = setInterval(() => tick().catch(() => null), intervalMs);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[UnhandledRejection]", reason);
  });

  process.on("uncaughtException", (err) => {
    console.error("[UncaughtException]", err);
  });

  await client.login(config.discordToken);
}

main().catch((err) => {
  console.error("[Fatal]", err);
  process.exit(1);
});
