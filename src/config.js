const dotenv = require("dotenv");

dotenv.config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name, fallback = undefined) {
  const v = process.env[name];
  return v ?? fallback;
}

function bool(name, fallback = false) {
  const v = optional(name);
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(
    String(v).trim().toLowerCase()
  );
}

function int(name, fallback) {
  const v = optional(name);
  if (v === undefined) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
const allowedRoleIds = String(process.env.ALLOWED_ROLE_IDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const config = {
  discordToken: required("DISCORD_TOKEN"),
  notifyChannelId: required("DISCORD_NOTIFY_CHANNEL_ID"),
  prefix: optional("PREFIX", "."),

  mentionHere: bool("MENTION_HERE", true),

  keywordRegex: optional("KEYWORD_REGEX", "nox\\s*rp"),

  checkIntervalSeconds: int("CHECK_INTERVAL_SECONDS", 60),

  // Optional discovery mode: scan platforms for ANY matching live stream
  discoveryMode: bool("DISCOVERY_MODE", false),
  discoveryTwitchPages: int("DISCOVERY_TWITCH_PAGES", 5),
  discoveryKickLimit: int("DISCOVERY_KICK_LIMIT", 100),

  twitch: {
    clientId: optional("TWITCH_CLIENT_ID"),
    clientSecret: optional("TWITCH_CLIENT_SECRET"),
    gta5GameId: optional("TWITCH_GTA5_GAME_ID", "32982"),
  },

  kick: {
    clientId: optional("KICK_CLIENT_ID"),
    clientSecret: optional("KICK_CLIENT_SECRET"),
    gtaCategoryName: optional("KICK_GTA_CATEGORY_NAME", "Grand Theft Auto V"),
  },
  allowedRoleIds,
};

module.exports = { config };
