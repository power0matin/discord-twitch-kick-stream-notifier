"use strict";

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  Events,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");

const { config } = require("./config");
const { loadDb, saveDb } = require("./storage");
const { KickClient } = require("./kick");
const { TwitchClient } = require("./twitch");

/* -------------------------- small utilities -------------------------- */

// Sleep helper for retry loops.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Identify transient network errors worth retrying.
function isTransientNetworkError(err) {
  const code = String(err?.code || "");
  const msg = String(err?.message || "").toLowerCase();

  // Common transient network conditions
  if (code === "ECONNRESET") return true;
  if (code === "ETIMEDOUT") return true;
  if (code === "ECONNREFUSED") return true;
  if (code === "EAI_AGAIN") return true; // DNS temp failure

  // Some TLS/socket wording variations
  if (msg.includes("socket hang up")) return true;
  if (msg.includes("read econnreset")) return true;

  return false;
}

// Treat invalid token/auth as fatal (retry won't help).
function isDiscordAuthError(err) {
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("invalid token") ||
    (msg.includes("token") && msg.includes("invalid"))
  );
}

// Retry Discord login with exponential backoff + jitter.
// Keeps process alive on transient failures like ECONNRESET.
async function loginWithRetry(client, token) {
  let attempt = 0;
  const minDelay = 2_000;
  const maxDelay = 60_000;

  for (;;) {
    try {
      await client.login(token);
      return;
    } catch (err) {
      if (isDiscordAuthError(err)) throw err;

      attempt += 1;
      const exp = Math.min(
        maxDelay,
        minDelay * Math.pow(2, Math.min(attempt, 6))
      );
      const jitter = Math.floor(Math.random() * 1_000);
      const waitMs = exp + jitter;

      // Low-noise actionable log
      console.error(
        "[Discord] Login failed; will retry:",
        err?.code || err?.message || err
      );

      // Best-effort cleanup before retry
      try {
        await client.destroy();
      } catch (_) {}

      await sleep(waitMs);
    }
  }
}

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

async function hasBotAccess(message) {
  try {
    const allowed = Array.isArray(config.allowedRoleIds)
      ? config.allowedRoleIds
      : [];
    if (allowed.length === 0) {
      // اگر رول تعریف نکردی، برای اینکه قفل نشه، مثل قبل ManageGuild رو قبول کن
      return (
        message?.member?.permissions?.has?.(
          PermissionsBitField.Flags.ManageGuild
        ) ?? false
      );
    }

    // member from message (usually available)
    let member = message.member;

    // fallback: fetch member if missing
    if (!member && message.guild && message.author?.id) {
      member = await message.guild.members
        .fetch(message.author.id)
        .catch(() => null);
    }
    if (!member) return false;

    // role check
    return allowed.some((roleId) => member.roles.cache.has(roleId));
  } catch {
    return false;
  }
}

function formatStreamerLine(i, name, discordId) {
  return discordId ? `${i}. ${name} <@${discordId}>` : `${i}. ${name}`;
}
/* -------------------------- embed utilities -------------------------- */

// Discord embed limits (roughly)
const EMBED_DESC_LIMIT = 4096;
const EMBED_FIELD_LIMIT = 1024;

function safeStr(v) {
  return String(v ?? "").trim();
}

function truncate(str, max) {
  const s = safeStr(str);
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function makeEmbed({ title, description, fields, footer, author }) {
  const e = new EmbedBuilder();

  if (author?.name) e.setAuthor({ name: author.name });
  if (title) e.setTitle(truncate(title, 256));
  if (description) e.setDescription(truncate(description, EMBED_DESC_LIMIT));

  if (Array.isArray(fields) && fields.length) {
    e.addFields(
      fields
        .filter(Boolean)
        .slice(0, 25) // embed field max
        .map((f) => ({
          name: truncate(safeStr(f.name), 256) || "\u200b",
          value: truncate(safeStr(f.value), EMBED_FIELD_LIMIT) || "\u200b",
          inline: Boolean(f.inline),
        }))
    );
  }

  if (footer?.text) e.setFooter({ text: truncate(footer.text, 2048) });
  e.setTimestamp(new Date());

  return e;
}

async function replyEmbed(message, embed, opts = {}) {
  return message
    .reply({
      embeds: [embed],
      allowedMentions: { parse: [] },
      ...opts,
    })
    .catch(() => null);
}

async function sendEmbed(message, embed, opts = {}) {
  return message.channel
    .send({
      embeds: [embed],
      allowedMentions: { parse: [] },
      ...opts,
    })
    .catch(() => null);
}

/**
 * Sends multiple embeds (paged). First page is a reply, then sends to channel.
 */
async function sendEmbedsPaged(message, embeds) {
  if (!Array.isArray(embeds) || embeds.length === 0) return;
  await replyEmbed(message, embeds[0]);
  for (let i = 1; i < embeds.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    await sendEmbed(message, embeds[i]);
  }
}

function buildPagedEmbeds({ title, header, lines, perPage = 15, requestedBy }) {
  const chunks = chunkArray(lines || [], perPage);
  const total = Math.max(1, chunks.length);

  return chunks.map((group, idx) => {
    const pageNo = idx + 1;
    const desc = [header, "", ...group].filter(Boolean).join("\n");

    return makeEmbed({
      title,
      description: desc,
      footer: {
        text: `Requested by ${requestedBy} • Page ${pageNo}/${total}`,
      },
    });
  });
}

function buildCodeEmbeds({ title, lang = "json", text, requestedBy }) {
  const prefix = `\`\`\`${lang}\n`;
  const suffix = "\n```";
  const budget = Math.max(
    500,
    EMBED_DESC_LIMIT - prefix.length - suffix.length
  );

  const parts = [];
  for (let i = 0; i < text.length; i += budget) {
    parts.push(text.slice(i, i + budget));
  }

  const total = Math.max(1, parts.length);
  return parts.map((p, idx) =>
    makeEmbed({
      title,
      description: `${prefix}${p}${suffix}`,
      footer: {
        text: `Requested by ${requestedBy} • Page ${idx + 1}/${total}`,
      },
    })
  );
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

  /*
    Settings precedence:
      - Default: DB is source of truth; env provides defaults on first run.
      - Optional legacy mode: ENV_OVERRIDES_DB=true forces env -> DB on startup.
  */
  function applyEnvDefaultsToDb() {
    const force = Boolean(config.envOverridesDb);

    const setIfMissing = (obj, key, value) => {
      if (
        force ||
        obj[key] === null ||
        obj[key] === undefined ||
        obj[key] === ""
      ) {
        obj[key] = value;
      }
    };

    db.settings ||= {};
    setIfMissing(db.settings, "notifyChannelId", config.notifyChannelId);
    setIfMissing(db.settings, "mentionHere", config.mentionHere);
    setIfMissing(db.settings, "keywordRegex", config.keywordRegex);
    setIfMissing(
      db.settings,
      "checkIntervalSeconds",
      config.checkIntervalSeconds
    );

    setIfMissing(db.settings, "discoveryMode", config.discoveryMode);
    setIfMissing(
      db.settings,
      "discoveryTwitchPages",
      config.discoveryTwitchPages
    );
    setIfMissing(db.settings, "discoveryKickLimit", config.discoveryKickLimit);

    setIfMissing(db.settings, "twitchGta5GameId", config.twitch.gta5GameId);
    setIfMissing(
      db.settings,
      "kickGtaCategoryName",
      config.kick.gtaCategoryName
    );
  }

  applyEnvDefaultsToDb();

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
  let healthDirty = false;

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

  /* ------------------------- health / backoff ------------------------- */

  function platformKeyToHealthKey(platformKey) {
    return platformKey === "kick" ? "kickHealth" : "twitchHealth";
  }

  function getPlatformHealth(platformKey) {
    const healthKey = platformKeyToHealthKey(platformKey);
    db.state[healthKey] ||= {
      consecutiveFailures: 0,
      nextAllowedAt: 0,
      lastError: null,
      lastErrorAt: 0,
      lastSuccessAt: 0,
      lastLoggedAt: 0,
    };
    return db.state[healthKey];
  }

  function isRetryableApiError(err) {
    const status = err?.response?.status;
    if (status === 429) return true;
    if (typeof status === "number" && status >= 500) return true;

    const code = String(err?.code ?? "").toUpperCase();
    return ["ETIMEDOUT", "ECONNRESET", "ECONNABORTED", "EAI_AGAIN"].includes(
      code
    );
  }

  function computeBackoffMs(err, consecutiveFailures) {
    const status = err?.response?.status;
    const retryAfter = err?.response?.headers?.["retry-after"];

    let base = status === 429 ? 60_000 : 30_000;

    if (retryAfter) {
      const sec = Number.parseInt(String(retryAfter), 10);
      if (Number.isFinite(sec) && sec > 0) {
        base = Math.max(base, sec * 1000);
      }
    }

    const exp = Math.min(6, Math.max(0, consecutiveFailures - 1));
    const backoff = Math.min(10 * 60_000, base * Math.pow(2, exp));

    // small jitter to avoid thundering herd on restarts
    const jitter = Math.floor(Math.random() * 5_000);
    return backoff + jitter;
  }

  function setPlatformFailure(platformKey, err, contextLabel) {
    const now = Date.now();
    const health = getPlatformHealth(platformKey);
    health.consecutiveFailures = Number(health.consecutiveFailures || 0) + 1;

    const retryable = isRetryableApiError(err);
    if (retryable) {
      const delayMs = computeBackoffMs(err, health.consecutiveFailures);
      health.nextAllowedAt = now + delayMs;
    }

    const status = err?.response?.status;
    const msg = err?.message ?? String(err);
    health.lastError = `${contextLabel || platformKey}: ${
      status ? `HTTP ${status} ` : ""
    }${msg}`;
    health.lastErrorAt = now;

    // Avoid noisy logs: max one log per 5 minutes per platform
    const shouldLog = now - Number(health.lastLoggedAt || 0) > 5 * 60_000;
    if (shouldLog) {
      health.lastLoggedAt = now;
      const until = health.nextAllowedAt
        ? new Date(health.nextAllowedAt).toISOString()
        : null;
      console.error(
        `[${platformKey.toUpperCase()}] API error. failures=${
          health.consecutiveFailures
        } backoffUntil=${until || "none"} err=${health.lastError}`
      );
    }

    healthDirty = true;

    return retryable;
  }

  function setPlatformSuccess(platformKey) {
    const health = getPlatformHealth(platformKey);
    health.consecutiveFailures = 0;
    health.nextAllowedAt = 0;
    health.lastSuccessAt = Date.now();
    healthDirty = true;
  }

  function platformInBackoff(platformKey) {
    const now = Date.now();
    const health = getPlatformHealth(platformKey);
    return Boolean(health.nextAllowedAt && now < health.nextAllowedAt);
  }

  function getDiscoveryMode() {
    return Boolean(db?.settings?.discoveryMode);
  }

  function getIntervalSeconds() {
    const n = Number(
      db?.settings?.checkIntervalSeconds ?? config.checkIntervalSeconds
    );
    if (!Number.isFinite(n)) return 60;
    return Math.max(10, Math.min(3600, Math.floor(n)));
  }

  async function ensureKickGtaCategoryId() {
    if (!kick.enabled) return null;
    const now = Date.now();

    // Cache refresh policy: re-resolve at most once per 24h (or when name changes).
    const cachedId = db.settings.kickGtaCategoryId;
    const resolvedAt = Number(db.settings.kickGtaCategoryResolvedAt || 0);
    const cacheFresh =
      cachedId && resolvedAt && now - resolvedAt < 24 * 60 * 60 * 1000;
    if (cacheFresh) return cachedId;

    // Respect backoff
    if (platformInBackoff("kick")) return cachedId || null;

    try {
      const id = await kick.findCategoryIdByName(
        db.settings.kickGtaCategoryName
      );
      db.settings.kickGtaCategoryId = id;
      db.settings.kickGtaCategoryResolvedAt = now;
      await saveDb(db);
      setPlatformSuccess("kick");
      return id;
    } catch (err) {
      setPlatformFailure("kick", err, "kick.findCategoryIdByName");
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
    if (platformInBackoff("kick")) return false;

    const gtaCategoryId = await ensureKickGtaCategoryId();
    if (!gtaCategoryId) return false;

    const keyword = getKeywordRegex();
    const slugs = db.kick.streamers
      .map((s) => normalizeName(s.slug))
      .filter(Boolean);
    if (slugs.length === 0) return false;

    const metaMap = buildKickMetaMap();
    let changed = false;

    let hadError = false;
    for (const group of chunkArray(slugs, 50)) {
      let channels = [];
      try {
        channels = await kick.getChannelsBySlugs(group);
      } catch (err) {
        hadError = true;
        setPlatformFailure("kick", err, "kick.getChannelsBySlugs");
        break;
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

    if (!hadError) setPlatformSuccess("kick");

    return changed;
  }

  async function discoverKick() {
    if (!kick.enabled || !getDiscoveryMode()) return false;
    if (platformInBackoff("kick")) return false;

    const gtaCategoryId = await ensureKickGtaCategoryId();
    if (!gtaCategoryId) return false;

    const keyword = getKeywordRegex();
    const limit = Math.min(
      100,
      Number(
        db?.settings?.discoveryKickLimit ?? config.discoveryKickLimit ?? 100
      )
    );

    let lives = [];
    try {
      lives = await kick.getLivestreamsByCategoryId(
        gtaCategoryId,
        limit,
        "started_at"
      );
    } catch (err) {
      setPlatformFailure("kick", err, "kick.getLivestreamsByCategoryId");
      return false;
    }

    setPlatformSuccess("kick");

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
    if (platformInBackoff("twitch")) return false;

    const keyword = getKeywordRegex();
    const gameId = String(db.settings.twitchGta5GameId ?? "32982");

    const logins = db.twitch.streamers
      .map((s) => normalizeName(s.login))
      .filter(Boolean);
    if (logins.length === 0) return false;

    const metaMap = buildTwitchMetaMap();
    let changed = false;

    let hadError = false;
    for (const group of chunkArray(logins, 100)) {
      let streams = [];
      try {
        // Only LIVE streams returned; filtered by game_id
        streams = await twitch.getStreamsByUserLogins(group, { gameId });
      } catch (err) {
        hadError = true;
        setPlatformFailure("twitch", err, "twitch.getStreamsByUserLogins");
        break;
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

    if (!hadError) setPlatformSuccess("twitch");

    return changed;
  }

  async function discoverTwitch() {
    if (!twitch.enabled || !getDiscoveryMode()) return false;
    if (platformInBackoff("twitch")) return false;

    const keyword = getKeywordRegex();
    const gameId = String(db.settings.twitchGta5GameId ?? "32982");
    const pages = Math.max(
      1,
      Math.min(
        50,
        Number(
          db?.settings?.discoveryTwitchPages ?? config.discoveryTwitchPages ?? 5
        )
      )
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
        setPlatformFailure("twitch", err, "twitch.getStreamsByGameId");
        return false;
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

    setPlatformSuccess("twitch");

    return changed;
  }

  /* ------------------------------- tick ------------------------------- */

  let lastMetaSaveAt = 0;

  async function tick() {
    if (tickRunning) return { changed: false };
    tickRunning = true;

    const startedAt = Date.now();
    db.state.lastTickAt = startedAt;

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
      db.state.lastTickDurationMs = Date.now() - startedAt;

      const now = Date.now();
      const shouldSaveMeta = now - lastMetaSaveAt > 5 * 60_000;
      if (changed || healthDirty || shouldSaveMeta) {
        await saveDb(db).catch(() => null);
        lastMetaSaveAt = now;
      }
      healthDirty = false;
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
    // Backwards compatibility: if you still call replySafe with text,
    // we wrap it into an embed to improve UI.
    const requestedBy = message?.author?.tag || "unknown";
    const e = makeEmbed({
      title: "Bot Reply",
      description: safeStr(content),
      footer: { text: `Requested by ${requestedBy}` },
    });
    return replyEmbed(message, e);
  }

  async function sendChunked(message, header, lines, maxLen = 1800) {
    // Ignore maxLen; we now page using embeds.
    const requestedBy = message?.author?.tag || "unknown";
    const embeds = buildPagedEmbeds({
      title: "List",
      header: safeStr(header),
      lines: (lines || []).map((x) => safeStr(x)),
      perPage: 15,
      requestedBy,
    });
    await sendEmbedsPaged(message, embeds);
  }

  async function sendCodeBlockChunked(message, lang, text, maxLen = 1900) {
    // Ignore maxLen; we page using embed description limit.
    const requestedBy = message?.author?.tag || "unknown";
    const embeds = buildCodeEmbeds({
      title: "Export",
      lang,
      text: safeStr(text),
      requestedBy,
    });
    await sendEmbedsPaged(message, embeds);
  }

  function parseOnOff(value) {
    const v = String(value ?? "")
      .trim()
      .toLowerCase();
    if (["1", "true", "yes", "y", "on", "enable", "enabled"].includes(v))
      return true;
    if (["0", "false", "no", "n", "off", "disable", "disabled"].includes(v))
      return false;
    return null;
  }

  function extractChannelId(message, arg) {
    // Accept #channel mention, raw ID, or current channel keyword
    const v = String(arg ?? "").trim();
    if (!v) return null;
    if (v === "here" || v === "this") return message?.channel?.id ?? null;

    const m = v.match(/^<#(\d{17,20})>$/);
    if (m?.[1]) return m[1];
    if (/^\d{17,20}$/.test(v)) return v;

    return null;
  }

  function validateRegexPattern(pattern) {
    const p = String(pattern ?? "").trim();
    if (!p) return { ok: false, error: "Regex cannot be empty." };
    if (p.length > 200)
      return { ok: false, error: "Regex is too long (max 200 chars)." };
    try {
      // Validate compile (case-insensitive behavior matches runtime)
      // eslint-disable-next-line no-new
      new RegExp(p, "i");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Invalid regex: ${err?.message ?? err}` };
    }
  }

  function formatTs(ts) {
    const n = Number(ts || 0);
    if (!n) return "-";
    return new Date(n).toISOString();
  }

  async function restartIntervalIfRunning() {
    const ms = getIntervalSeconds() * 1000;
    if (intervalHandle) clearInterval(intervalHandle);
    intervalHandle = setInterval(() => tick().catch(() => null), ms);
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
      const requestedBy = message?.author?.tag || "unknown";

      const e = makeEmbed({
        title: "Stream Notifier Bot • Commands",
        description: `Prefix: \`${config.prefix}\`\nUse \`${config.prefix}help\` anytime.`,
        fields: [
          {
            name: "General",
            value: [
              `\`${prefix}config\`  (show current settings)`,
              `\`${prefix}health\`  (tick + API/backoff status)`,
              `\`${prefix}export [all|kick|twitch]\`  (no secrets)`,
              `\`${prefix}tick\`  (manual scan)`,
            ].join("\n"),
          },
          {
            name: "Settings (admin)",
            value: [
              `\`${prefix}set channel <#channel|channelId|this>\``,
              `\`${prefix}set mentionhere <on|off>\``,
              `\`${prefix}set regex <pattern>\``,
              `\`${prefix}set interval <seconds>\`  (10..3600)`,
              `\`${prefix}set discovery <on|off>\``,
              `\`${prefix}set discoveryTwitchPages <1..50>\``,
              `\`${prefix}set discoveryKickLimit <1..100>\``,
              `\`${prefix}set twitchGameId <game_id>\``,
              `\`${prefix}set kickCategoryName <name>\``,
              `\`${prefix}refresh kickCategory\``,
            ].join("\n"),
          },
          {
            name: "Kick",
            value: [
              `\`${prefix}k list\``,
              `\`${prefix}k add <kickSlug> [@discordUser]\``,
              `\`${prefix}k addmany <slug1> <slug2> ...\``,
              `\`${prefix}k setmention <kickSlug> <@user|id|none>\``,
              `\`${prefix}k remove <kickSlug>\``,
              `\`${prefix}k clear --yes\``,
              `\`${prefix}k status <kickSlug>\``,
            ].join("\n"),
            inline: true,
          },
          {
            name: "Twitch",
            value: [
              `\`${prefix}t list\``,
              `\`${prefix}t add <twitchLogin> [@discordUser]\``,
              `\`${prefix}t addmany <login1> <login2> ...\``,
              `\`${prefix}t setmention <twitchLogin> <@user|id|none>\``,
              `\`${prefix}t remove <twitchLogin>\``,
              `\`${prefix}t clear --yes\``,
              `\`${prefix}t status <twitchLogin>\``,
            ].join("\n"),
            inline: true,
          },
        ],
        footer: { text: `Requested by ${requestedBy}` },
      });

      await replyEmbed(message, e);
      return;
    }

    if (cmdLower === "config") {
      if (!(await hasBotAccess(message))) {
        await replySafe(
          message,
          "❌ | You don't have permission to use this bot."
        );
        return;
      }

      const notify = db?.settings?.notifyChannelId
        ? `<#${db.settings.notifyChannelId}> (${db.settings.notifyChannelId})`
        : "(not set)";

      const text = [
        "**Current Bot Configuration**",
        `Channel: ${notify}`,
        `mentionHere: **${Boolean(db.settings.mentionHere) ? "on" : "off"}**`,
        `keywordRegex: \`${String(db.settings.keywordRegex)}\``,
        `intervalSeconds: **${getIntervalSeconds()}**`,
        "",
        "**Discovery**",
        `discoveryMode: **${getDiscoveryMode() ? "on" : "off"}**`,
        `discoveryTwitchPages: **${Number(
          db.settings.discoveryTwitchPages || 5
        )}**`,
        `discoveryKickLimit: **${Number(
          db.settings.discoveryKickLimit || 100
        )}**`,
        "",
        "**Filters**",
        `Twitch game_id: **${String(
          db.settings.twitchGta5GameId ?? "32982"
        )}**`,
        `Kick category name: **${
          String(db.settings.kickGtaCategoryName ?? "") || "-"
        }**`,
        `Kick category id: **${
          db.settings.kickGtaCategoryId ?? "-"
        }** (resolvedAt: ${formatTs(db.settings.kickGtaCategoryResolvedAt)})`,
        "",
        "**Lists**",
        `Kick streamers: **${db.kick.streamers.length}**`,
        `Twitch streamers: **${db.twitch.streamers.length}**`,
      ].join("\n");

      await replySafe(message, text);
      return;
    }

    if (cmdLower === "health") {
      if (!(await hasBotAccess(message))) {
        await replySafe(
          message,
          "❌ | You don't have permission to use this bot."
        );
        return;
      }

      const kickH = getPlatformHealth("kick");
      const twitchH = getPlatformHealth("twitch");

      const kickActive = Object.keys(db.state.kickActiveMessages || {}).length;
      const twitchActive = Object.keys(
        db.state.twitchActiveMessages || {}
      ).length;

      const fmtBackoff = (h) =>
        h?.nextAllowedAt && Date.now() < h.nextAllowedAt
          ? formatTs(h.nextAllowedAt)
          : "-";

      const text = [
        "**Bot Health**",
        `lastTickAt: **${formatTs(db.state.lastTickAt)}**`,
        `lastTickDurationMs: **${Number(db.state.lastTickDurationMs || 0)}**`,
        `activeMessages: Kick **${kickActive}**, Twitch **${twitchActive}**`,
        "",
        "**Kick**",
        `enabled: **${kick.enabled ? "yes" : "no"}**`,
        `failures: **${Number(kickH.consecutiveFailures || 0)}**`,
        `backoffUntil: **${fmtBackoff(kickH)}**`,
        `lastSuccessAt: **${formatTs(kickH.lastSuccessAt)}**`,
        `lastErrorAt: **${formatTs(kickH.lastErrorAt)}**`,
        `lastError: ${kickH.lastError ? `\`${kickH.lastError}\`` : "-"}`,
        "",
        "**Twitch**",
        `enabled: **${twitch.enabled ? "yes" : "no"}**`,
        `failures: **${Number(twitchH.consecutiveFailures || 0)}**`,
        `backoffUntil: **${fmtBackoff(twitchH)}**`,
        `lastSuccessAt: **${formatTs(twitchH.lastSuccessAt)}**`,
        `lastErrorAt: **${formatTs(twitchH.lastErrorAt)}**`,
        `lastError: ${twitchH.lastError ? `\`${twitchH.lastError}\`` : "-"}`,
      ].join("\n");

      await replySafe(message, text);
      return;
    }

    if (cmdLower === "export") {
      if (!(await hasBotAccess(message))) {
        await replySafe(
          message,
          "❌ | You don't have permission to use this bot."
        );
        return;
      }

      const what = normalizeName(args[0] || "all");
      const payload = {
        settings: {
          notifyChannelId: db.settings.notifyChannelId,
          mentionHere: db.settings.mentionHere,
          keywordRegex: db.settings.keywordRegex,
          checkIntervalSeconds: getIntervalSeconds(),
          discoveryMode: db.settings.discoveryMode,
          discoveryTwitchPages: db.settings.discoveryTwitchPages,
          discoveryKickLimit: db.settings.discoveryKickLimit,
          twitchGta5GameId: db.settings.twitchGta5GameId,
          kickGtaCategoryName: db.settings.kickGtaCategoryName,
        },
      };

      if (what === "all" || what === "kick")
        payload.kick = { streamers: db.kick.streamers };
      if (what === "all" || what === "twitch")
        payload.twitch = { streamers: db.twitch.streamers };

      const json = JSON.stringify(payload, null, 2);
      await sendCodeBlockChunked(message, "json", json);
      return;
    }

    if (cmdLower === "refresh") {
      if (!(await hasBotAccess(message))) {
        await replySafe(
          message,
          "❌ | You don't have permission to use this bot."
        );
        return;
      }

      const sub = normalizeName(args[0]);
      if (sub === "kickcategory") {
        db.settings.kickGtaCategoryId = null;
        db.settings.kickGtaCategoryResolvedAt = 0;
        await saveDb(db).catch(() => null);

        const id = await ensureKickGtaCategoryId();
        await replySafe(
          message,
          id
            ? `✅ | Kick category resolved: **${id}** (${db.settings.kickGtaCategoryName})`
            : `⚠️ | Failed to resolve Kick category. Check \`${prefix}health\` for details.`
        );
        return;
      }

      await replySafe(message, `⚠️ | Usage: \`${prefix}refresh kickCategory\``);
      return;
    }

    if (cmdLower === "set") {
      if (!(await hasBotAccess(message))) {
        await replySafe(
          message,
          "❌ | You don't have permission to use this bot."
        );
        return;
      }

      const sub = normalizeName(args[0]);
      if (!sub) {
        await replySafe(message, `⚠️ | Usage: \`${prefix}set <key> <value>\``);
        return;
      }

      if (sub === "channel") {
        const chId = extractChannelId(message, args[1]);
        if (!chId) {
          await replySafe(
            message,
            `⚠️ | Usage: \`${prefix}set channel <#channel|channelId|this>\``
          );
          return;
        }

        // Validate channel is sendable
        const ch = await client.channels.fetch(chId).catch(() => null);
        if (!ch || !("send" in ch) || ch.type === ChannelType.DM) {
          await replySafe(
            message,
            "❌ | Invalid channel (must be a guild text channel the bot can send to)."
          );
          return;
        }

        db.settings.notifyChannelId = chId;
        await saveDb(db).catch(() => null);
        await replySafe(message, `✅ | notify channel set to <#${chId}>`);
        return;
      }

      if (sub === "mentionhere") {
        const v = parseOnOff(args[1]);
        if (v === null) {
          await replySafe(
            message,
            `⚠️ | Usage: \`${prefix}set mentionhere <on|off>\``
          );
          return;
        }
        db.settings.mentionHere = v;
        await saveDb(db).catch(() => null);
        await replySafe(
          message,
          `✅ | mentionHere set to **${v ? "on" : "off"}**`
        );
        return;
      }

      if (sub === "interval") {
        const n = Number.parseInt(String(args[1] ?? ""), 10);
        if (!Number.isFinite(n) || n < 10 || n > 3600) {
          await replySafe(
            message,
            `⚠️ | Usage: \`${prefix}set interval <seconds>\` (10..3600)`
          );
          return;
        }
        db.settings.checkIntervalSeconds = n;
        await saveDb(db).catch(() => null);
        await restartIntervalIfRunning();
        await replySafe(
          message,
          `✅ | intervalSeconds set to **${getIntervalSeconds()}**`
        );
        return;
      }

      if (sub === "discovery") {
        const v = parseOnOff(args[1]);
        if (v === null) {
          await replySafe(
            message,
            `⚠️ | Usage: \`${prefix}set discovery <on|off>\``
          );
          return;
        }
        db.settings.discoveryMode = v;
        await saveDb(db).catch(() => null);
        await replySafe(
          message,
          `✅ | discoveryMode set to **${v ? "on" : "off"}**`
        );
        return;
      }

      if (sub === "discoverytwitchpages") {
        const n = Number.parseInt(String(args[1] ?? ""), 10);
        if (!Number.isFinite(n) || n < 1 || n > 50) {
          await replySafe(
            message,
            `⚠️ | Usage: \`${prefix}set discoveryTwitchPages <1..50>\``
          );
          return;
        }
        db.settings.discoveryTwitchPages = n;
        await saveDb(db).catch(() => null);
        await replySafe(message, `✅ | discoveryTwitchPages set to **${n}**`);
        return;
      }

      if (sub === "discoverykicklimit") {
        const n = Number.parseInt(String(args[1] ?? ""), 10);
        if (!Number.isFinite(n) || n < 1 || n > 100) {
          await replySafe(
            message,
            `⚠️ | Usage: \`${prefix}set discoveryKickLimit <1..100>\``
          );
          return;
        }
        db.settings.discoveryKickLimit = n;
        await saveDb(db).catch(() => null);
        await replySafe(message, `✅ | discoveryKickLimit set to **${n}**`);
        return;
      }

      if (sub === "twitchgameid") {
        const id = String(args[1] ?? "").trim();
        if (!id) {
          await replySafe(
            message,
            `⚠️ | Usage: \`${prefix}set twitchGameId <game_id>\``
          );
          return;
        }
        db.settings.twitchGta5GameId = id;
        await saveDb(db).catch(() => null);
        await replySafe(message, `✅ | Twitch game_id set to **${id}**`);
        return;
      }

      // Space-preserving values
      if (sub === "regex") {
        const match = raw.match(/^set\s+regex\s+([\s\S]+)$/i);
        const pattern = match?.[1] ? String(match[1]).trim() : "";
        const v = validateRegexPattern(pattern);
        if (!v.ok) {
          await replySafe(message, `❌ | ${v.error}`);
          return;
        }
        db.settings.keywordRegex = pattern;
        await saveDb(db).catch(() => null);
        await replySafe(message, `✅ | keywordRegex set to \`${pattern}\``);
        return;
      }

      if (sub === "kickcategoryname") {
        const match = raw.match(/^set\s+kickCategoryName\s+([\s\S]+)$/i);
        const name = match?.[1] ? String(match[1]).trim() : "";
        if (!name) {
          await replySafe(
            message,
            `⚠️ | Usage: \`${prefix}set kickCategoryName <name>\``
          );
          return;
        }
        db.settings.kickGtaCategoryName = name;
        db.settings.kickGtaCategoryId = null;
        db.settings.kickGtaCategoryResolvedAt = 0;
        await saveDb(db).catch(() => null);
        await replySafe(
          message,
          `✅ | Kick category name set to **${name}** (will re-resolve id)`
        );
        return;
      }

      await replySafe(
        message,
        `⚠️ | Unknown setting key: **${sub}**. Use \`${prefix}help\`.`
      );
      return;
    }

    if (cmdLower === "tick") {
      if (!(await hasBotAccess(message))) {
        await replySafe(
          message,
          "❌ | You don't have permission to use this bot."
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
      if (!(await hasBotAccess(message))) {
        await replySafe(
          message,
          "❌ | You don't have permission to use this bot."
        );
        return;
      }

      const sub = normalizeName(args[0]);

      if (sub === "list") {
        if (db.kick.streamers.length === 0) {
          await replySafe(message, "🎥 | Kick Streamers List: (empty)");
          return;
        }
        const lines = db.kick.streamers.map((s, i) =>
          formatStreamerLine(i + 1, s.slug, s.discordId)
        );
        await sendChunked(message, "🎥 | Kick Streamers List:", lines);
        return;
      }

      if (sub === "status") {
        const st = await kickStatus(args[1]);
        await replySafe(message, st.msg);
        return;
      }

      if (sub === "addmany") {
        const slugs = args.slice(1).map(normalizeName).filter(Boolean);
        if (slugs.length === 0) {
          await replySafe(
            message,
            `⚠️ | Usage: \`${prefix}k addmany <slug1> <slug2> ...\``
          );
          return;
        }

        const existing = new Set(
          db.kick.streamers.map((s) => normalizeName(s.slug))
        );
        let added = 0;
        for (const slug of slugs) {
          if (!slug) continue;
          if (existing.has(slug)) continue;
          db.kick.streamers.push({ slug, discordId: null });
          existing.add(slug);
          added++;
        }

        await saveDb(db).catch(() => null);
        await replySafe(message, `✅ | Added **${added}** Kick streamer(s).`);
        return;
      }

      if (sub === "setmention") {
        const slug = normalizeName(args[1]);
        const who = String(args[2] ?? "").trim();
        if (!slug) {
          await replySafe(
            message,
            `⚠️ | Usage: \`${prefix}k setmention <kickSlug> <@user|id|none>\``
          );
          return;
        }

        const row = db.kick.streamers.find(
          (s) => normalizeName(s.slug) === slug
        );
        if (!row) {
          await replySafe(
            message,
            `⚠️ | Streamer ${slug} not found in Kick list.`
          );
          return;
        }

        let discordId = null;
        if (who && normalizeName(who) !== "none") {
          discordId = extractDiscordId(message, args.slice(2));
          if (!discordId) {
            await replySafe(
              message,
              `⚠️ | Could not parse Discord user. Use a real mention or raw ID, or \`none\`.`
            );
            return;
          }
        }

        row.discordId = discordId;
        await saveDb(db).catch(() => null);
        await replySafe(
          message,
          discordId
            ? `✅ | ${slug} mention set to <@${discordId}>`
            : `✅ | ${slug} mention cleared.`
        );
        return;
      }

      if (sub === "clear") {
        const ok = String(args[1] ?? "") === "--yes";
        if (!ok) {
          await replySafe(
            message,
            `⚠️ | This will remove ALL Kick streamers. Confirm: \`${prefix}k clear --yes\``
          );
          return;
        }

        const toDelete = db.kick.streamers
          .map((s) => normalizeName(s.slug))
          .filter(Boolean);
        db.kick.streamers = [];
        for (const slug of toDelete) {
          // best-effort message cleanup
          // eslint-disable-next-line no-await-in-loop
          await ensureOfflineMessageDeleted("kick", slug);
        }
        await saveDb(db).catch(() => null);
        await replySafe(
          message,
          `🗑️ | Cleared Kick streamer list (**${toDelete.length}** removed).`
        );
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

      if (
        !slug ||
        [
          "list",
          "remove",
          "add",
          "status",
          "addmany",
          "setmention",
          "clear",
        ].includes(slug)
      ) {
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
      if (!(await hasBotAccess(message))) {
        await replySafe(
          message,
          "❌ | You don't have permission to use this bot."
        );
        return;
      }

      const sub = normalizeName(args[0]);

      if (sub === "list") {
        if (db.twitch.streamers.length === 0) {
          await replySafe(message, "🎥 | Twitch Streamers List: (empty)");
          return;
        }
        const lines = db.twitch.streamers.map((s, i) =>
          formatStreamerLine(i + 1, s.login, s.discordId)
        );
        await sendChunked(message, "🎥 | Twitch Streamers List:", lines);
        return;
      }

      if (sub === "status") {
        const st = await twitchStatus(args[1]);
        await replySafe(message, st.msg);
        return;
      }

      if (sub === "addmany") {
        const logins = args.slice(1).map(normalizeName).filter(Boolean);
        if (logins.length === 0) {
          await replySafe(
            message,
            `⚠️ | Usage: \`${prefix}t addmany <login1> <login2> ...\``
          );
          return;
        }

        const existing = new Set(
          db.twitch.streamers.map((s) => normalizeName(s.login))
        );
        let added = 0;
        for (const login of logins) {
          if (!login) continue;
          if (existing.has(login)) continue;
          db.twitch.streamers.push({ login, discordId: null });
          existing.add(login);
          added++;
        }

        await saveDb(db).catch(() => null);
        await replySafe(message, `✅ | Added **${added}** Twitch streamer(s).`);
        return;
      }

      if (sub === "setmention") {
        const login = normalizeName(args[1]);
        const who = String(args[2] ?? "").trim();
        if (!login) {
          await replySafe(
            message,
            `⚠️ | Usage: \`${prefix}t setmention <twitchLogin> <@user|id|none>\``
          );
          return;
        }

        const row = db.twitch.streamers.find(
          (s) => normalizeName(s.login) === login
        );
        if (!row) {
          await replySafe(
            message,
            `⚠️ | Streamer ${login} not found in Twitch list.`
          );
          return;
        }

        let discordId = null;
        if (who && normalizeName(who) !== "none") {
          discordId = extractDiscordId(message, args.slice(2));
          if (!discordId) {
            await replySafe(
              message,
              `⚠️ | Could not parse Discord user. Use a real mention or raw ID, or \`none\`.`
            );
            return;
          }
        }

        row.discordId = discordId;
        await saveDb(db).catch(() => null);
        await replySafe(
          message,
          discordId
            ? `✅ | ${login} mention set to <@${discordId}>`
            : `✅ | ${login} mention cleared.`
        );
        return;
      }

      if (sub === "clear") {
        const ok = String(args[1] ?? "") === "--yes";
        if (!ok) {
          await replySafe(
            message,
            `⚠️ | This will remove ALL Twitch streamers. Confirm: \`${prefix}t clear --yes\``
          );
          return;
        }

        const toDelete = db.twitch.streamers
          .map((s) => normalizeName(s.login))
          .filter(Boolean);
        db.twitch.streamers = [];
        for (const login of toDelete) {
          // best-effort message cleanup
          // eslint-disable-next-line no-await-in-loop
          await ensureOfflineMessageDeleted("twitch", login);
        }
        await saveDb(db).catch(() => null);
        await replySafe(
          message,
          `🗑️ | Cleared Twitch streamer list (**${toDelete.length}** removed).`
        );
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

      if (
        !login ||
        [
          "list",
          "remove",
          "add",
          "status",
          "addmany",
          "setmention",
          "clear",
        ].includes(login)
      ) {
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
    console.log("[Config] intervalSeconds:", getIntervalSeconds());
    console.log("[Config] discoveryMode:", getDiscoveryMode());

    console.log(`Logged in as ${c.user.tag}`);

    await tick();
    await restartIntervalIfRunning();
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[UnhandledRejection]", reason);
  });

  process.on("uncaughtException", (err) => {
    console.error("[UncaughtException]", err);
  });

  await loginWithRetry(client, config.discordToken);
}

main().catch((err) => {
  // Keep process alive for transient network conditions.
  console.error("[Fatal]", err);
});
