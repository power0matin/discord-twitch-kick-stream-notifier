const fs = require("node:fs/promises");
const path = require("node:path");

const DB_PATH = path.join(process.cwd(), "data.json");

const DEFAULT_DB = {
  settings: {
    notifyChannelId: null,
    mentionHere: true,
    keywordRegex: "nox\\s*rp",
    checkIntervalSeconds: 60,

    // Discovery settings (optional)
    discoveryMode: false,
    discoveryTwitchPages: 5,
    discoveryKickLimit: 100,

    twitchGta5GameId: "32982",
    kickGtaCategoryName: "Grand Theft Auto V",
    kickGtaCategoryId: null,
    kickGtaCategoryResolvedAt: 0,
  },
  kick: {
    streamers: [], // { slug, discordId|null }
  },
  twitch: {
    streamers: [], // { login, discordId|null }
  },
  state: {
    // (legacy) kept for backward compatibility if you used it before:
    kickLastAnnounced: {},
    twitchLastAnnounced: {},

    // NEW: persistent message tracking
    // key -> streamer, value -> { messageId, sessionKey, createdAt }
    kickActiveMessages: {},
    twitchActiveMessages: {},

    // Health/backoff state (helps avoid rate-limit hammering)
    kickHealth: {
      consecutiveFailures: 0,
      nextAllowedAt: 0,
      lastError: null,
      lastErrorAt: 0,
      lastSuccessAt: 0,
      lastLoggedAt: 0,
    },
    twitchHealth: {
      consecutiveFailures: 0,
      nextAllowedAt: 0,
      lastError: null,
      lastErrorAt: 0,
      lastSuccessAt: 0,
      lastLoggedAt: 0,
    },

    // Tick metadata
    lastTickAt: 0,
    lastTickDurationMs: 0,
  },
};

async function loadDb() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);

    // Merge defaults (shallow + nested)
    const db = {
      ...DEFAULT_DB,
      ...parsed,
      settings: { ...DEFAULT_DB.settings, ...(parsed.settings ?? {}) },
      kick: { ...DEFAULT_DB.kick, ...(parsed.kick ?? {}) },
      twitch: { ...DEFAULT_DB.twitch, ...(parsed.twitch ?? {}) },
      state: { ...DEFAULT_DB.state, ...(parsed.state ?? {}) },
    };

    // Ensure nested objects exist (in case old db.json is missing these keys)
    db.kick.streamers ||= [];
    db.twitch.streamers ||= [];
    db.state.kickLastAnnounced ||= {};
    db.state.twitchLastAnnounced ||= {};
    db.state.kickActiveMessages ||= {};
    db.state.twitchActiveMessages ||= {};

    db.state.kickHealth = {
      ...DEFAULT_DB.state.kickHealth,
      ...(db.state.kickHealth ?? {}),
    };
    db.state.twitchHealth = {
      ...DEFAULT_DB.state.twitchHealth,
      ...(db.state.twitchHealth ?? {}),
    };
    db.state.lastTickAt ||= 0;
    db.state.lastTickDurationMs ||= 0;

    return db;
  } catch (err) {
    if (err && err.code === "ENOENT") {
      const db = structuredClone(DEFAULT_DB);
      await saveDb(db);
      return db;
    }
    throw err;
  }
}

async function saveDb(db) {
  const tmpPath = DB_PATH + ".tmp";
  const raw = JSON.stringify(db, null, 2);
  await fs.writeFile(tmpPath, raw, "utf8");
  await fs.rename(tmpPath, DB_PATH);
}

module.exports = { loadDb, saveDb, DB_PATH };
