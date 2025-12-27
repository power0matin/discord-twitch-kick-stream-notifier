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

  // ---- NEW MODULES (backward-compatible) ----
  fivem: {
    settings: {
      enabled: false,
      baseUrl: null, // e.g. http://127.0.0.1:30120
      statusChannelId: null,
      statusMessageId: null, // edited in-place to avoid spam
      checkIntervalSeconds: 60,
      timeoutMs: 5000,
      showPlayers: false,
      maxPlayersShown: 10,
      connectLabel: "Connect",
    },
    state: {
      consecutiveFailures: 0,
      nextAllowedAt: 0,
      lastError: null,
      lastErrorAt: 0,
      lastSuccessAt: 0,
      lastCheckedAt: 0,
      lastOnline: null,
    },
  },

  tickets: {
    settings: {
      enabled: false,
      categoryId: null,
      staffRoleIds: [],
      logChannelId: null,

      panelChannelId: null,
      panelMessageId: null,

      ticketNamePrefix: "ticket",
      maxOpenPerUser: 1,
      allowUserClose: true,
    },
    state: {
      openByUserId: {}, // userId -> channelId
      openByChannelId: {}, // channelId -> userId
    },
  },

  welcome: {
    settings: {
      enabled: false,
      channelId: null,

      // Keep for backward compatibility (older configs might still use it)
      messageTemplate: "Welcome {mention} to **{server}**!",

      // NEW: embed-specific templates (no mention inside embed)
      embedTitle: "NOX Community",
      embedDescriptionTemplate:
        "Welcome to the NOX Community! We are glad to have you./n",

      // NEW: link buttons under embed
      buttons: {
        button1Label: "Rules",
        button1Url: null,
        button2Label: "Website",
        button2Url: null,
      },

      dmEnabled: false,
      dmTemplate: "Welcome to {server}!",
      autoRoleId: null,
    },
  },

  // ---- END NEW MODULES ----

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
      fivem: { ...DEFAULT_DB.fivem, ...(parsed.fivem ?? {}) },
      tickets: { ...DEFAULT_DB.tickets, ...(parsed.tickets ?? {}) },
      welcome: { ...DEFAULT_DB.welcome, ...(parsed.welcome ?? {}) },

      kick: { ...DEFAULT_DB.kick, ...(parsed.kick ?? {}) },
      twitch: { ...DEFAULT_DB.twitch, ...(parsed.twitch ?? {}) },
      state: { ...DEFAULT_DB.state, ...(parsed.state ?? {}) },
    };

    // Ensure nested objects exist (in case old db.json is missing these keys)
    db.kick.streamers ||= [];
    db.twitch.streamers ||= [];

    db.fivem ||= structuredClone(DEFAULT_DB.fivem);
    db.fivem.settings = {
      ...DEFAULT_DB.fivem.settings,
      ...(db.fivem.settings ?? {}),
    };
    db.fivem.state = { ...DEFAULT_DB.fivem.state, ...(db.fivem.state ?? {}) };

    db.tickets ||= structuredClone(DEFAULT_DB.tickets);
    db.tickets.settings = {
      ...DEFAULT_DB.tickets.settings,
      ...(db.tickets.settings ?? {}),
    };
    db.tickets.state = {
      ...DEFAULT_DB.tickets.state,
      ...(db.tickets.state ?? {}),
    };
    db.tickets.settings.staffRoleIds ||= [];
    db.tickets.state.openByUserId ||= {};
    db.tickets.state.openByChannelId ||= {};

    db.welcome ||= structuredClone(DEFAULT_DB.welcome);
    db.welcome.settings = {
      ...DEFAULT_DB.welcome.settings,
      ...(db.welcome.settings ?? {}),
    };

    // Ensure nested buttons object is merged and always exists
    db.welcome.settings.buttons = {
      ...DEFAULT_DB.welcome.settings.buttons,
      ...(db.welcome.settings.buttons ?? {}),
    };

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
