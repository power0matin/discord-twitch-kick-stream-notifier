"use strict";

const axios = require("axios");
const {
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const EPHEMERAL_FLAG = MessageFlags?.Ephemeral ?? 1 << 6;

function normalizeBaseUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  // Basic sanity: must look like http(s)://host:port
  if (!/^https?:\/\/[^/\s]+(:\d+)?$/i.test(raw)) return null;

  return raw.replace(/\/+$/g, "");
}

function fmtBool(v) {
  return v ? "ON" : "OFF";
}

function nowMs() {
  return Date.now();
}

function nextBackoffMs(consecutiveFailures) {
  const base = 5_000; // 5s
  const cap = 120_000; // 2min
  const exp = Math.min(
    cap,
    base * Math.pow(2, Math.min(consecutiveFailures, 6))
  );
  const jitter = Math.floor(Math.random() * 750);
  return exp + jitter;
}

function withEphemeralFlags(payload) {
  if (!payload || typeof payload !== "object") return payload;

  if (payload.flags != null) {
    if ("ephemeral" in payload) {
      const { ephemeral: _e, ...rest } = payload;
      return rest;
    }
    return payload;
  }

  if (payload.ephemeral === true) {
    const { ephemeral: _e, ...rest } = payload;
    return { ...rest, flags: EPHEMERAL_FLAG };
  }

  return payload;
}

async function safeReply(interaction, payload) {
  const p = withEphemeralFlags(payload);
  try {
    if (interaction.deferred || interaction.replied)
      return await interaction.followUp(p);
    return await interaction.reply(p);
  } catch (_) {
    return null;
  }
}

async function fetchJson(url, timeoutMs) {
  const res = await axios.get(url, {
    timeout: timeoutMs,
    validateStatus: () => true,
    headers: { "User-Agent": "fivem-discord-manager-bot/1.0" },
  });

  // FiveM servers may return "Nope." when protected; treat as blocked.
  const ct = String(res.headers?.["content-type"] || "").toLowerCase();
  const isJson = ct.includes("application/json") || ct.includes("text/json");

  if (res.status >= 200 && res.status < 300) {
    if (isJson && typeof res.data === "object")
      return { ok: true, data: res.data };
    // Sometimes server returns text; keep it
    return { ok: true, data: res.data };
  }

  return { ok: false, status: res.status, data: res.data };
}

async function getFiveMStatus(baseUrl, timeoutMs) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) {
    return {
      online: false,
      blocked: false,
      reason: "Invalid endpoint URL.",
      info: null,
      dynamic: null,
      players: null,
    };
  }

  const infoUrl = `${base}/info.json`;
  const dynamicUrl = `${base}/dynamic.json`;
  const playersUrl = `${base}/players.json`;

  // Use dynamic.json as primary signal (contains clients/hostname in most cases)
  const [dynamic, info, players] = await Promise.allSettled([
    fetchJson(dynamicUrl, timeoutMs),
    fetchJson(infoUrl, timeoutMs),
    fetchJson(playersUrl, timeoutMs),
  ]);

  const dyn =
    dynamic.status === "fulfilled" ? dynamic.value : { ok: false, data: null };
  const inf =
    info.status === "fulfilled" ? info.value : { ok: false, data: null };
  const ply =
    players.status === "fulfilled" ? players.value : { ok: false, data: null };

  const textNope = (x) => {
    const d = x?.data;
    if (typeof d === "string" && d.toLowerCase().includes("nope")) return true;
    return false;
  };

  const blocked = textNope(dyn) || textNope(inf) || textNope(ply);

  const online = dyn.ok || inf.ok || ply.ok;

  return {
    online,
    blocked,
    reason: blocked ? "Server blocks info endpoints (Nope)." : null,
    info: inf.ok ? inf.data : null,
    dynamic: dyn.ok ? dyn.data : null,
    players: ply.ok ? ply.data : null,
  };
}

function buildStatusEmbed(ctx, status) {
  const db = ctx.getDb();
  const s = db.fivem?.settings || {};
  const base = s.baseUrl;

  const dynamic = status.dynamic || {};
  const info = status.info || {};
  const players = Array.isArray(status.players) ? status.players : [];

  const hostname =
    (typeof dynamic.hostname === "string" && dynamic.hostname) ||
    (typeof info.vars?.sv_projectName === "string" &&
      info.vars.sv_projectName) ||
    (typeof info.vars?.sv_hostname === "string" && info.vars.sv_hostname) ||
    (typeof info.server === "string" && info.server) ||
    "FiveM Server";

  const maxClients =
    Number(
      dynamic.sv_maxclients ||
        dynamic.vars?.sv_maxclients ||
        info.vars?.sv_maxclients ||
        0
    ) || null;

  const clients = Number(dynamic.clients || dynamic.players || 0) || 0;

  const onlineText = status.online ? "✅ ONLINE" : "❌ OFFLINE";
  const blockedText = status.blocked ? "⚠️ Endpoints blocked (Nope)" : "OK";

  const fields = [
    { name: "Status", value: `${onlineText}`, inline: true },
    {
      name: "Endpoint",
      value: base ? `\`${base}\`` : "_Not set_",
      inline: false,
    },
  ];

  if (status.online) {
    const pop = maxClients ? `${clients}/${maxClients}` : `${clients}`;
    fields.push({ name: "Players", value: pop, inline: true });
    fields.push({ name: "Visibility", value: blockedText, inline: true });
  } else {
    fields.push({ name: "Visibility", value: blockedText, inline: true });
    if (status.reason)
      fields.push({ name: "Reason", value: status.reason, inline: false });
  }

  // Optional player list (safe/truncated)
  if (status.online && s.showPlayers && players.length > 0) {
    const maxShown = Math.max(0, Math.min(Number(s.maxPlayersShown || 10), 25));
    const names = players
      .slice(0, maxShown)
      .map((p, i) => {
        const n = String(p?.name || "unknown")
          .replace(/\s+/g, " ")
          .trim();
        return `${i + 1}. ${n || "unknown"}`;
      })
      .join("\n");

    fields.push({
      name: `Players (top ${Math.min(players.length, maxShown)}/${
        players.length
      })`,
      value: names.length ? names : "_No player names available_",
      inline: false,
    });
  }

  const e = ctx.makeEmbed(null, {
    tone: status.online ? "SUCCESS" : "DANGER",
    title: `FiveM • ${hostname}`,
    description: "Live server status (auto message is edited to avoid spam).",
    fields,
    footer: {
      text: `Updated ${ctx.fmtDiscordTime(Date.now(), "R")}`,
    },
  });

  return e;
}

async function ensureStatusMessage(ctx, embed) {
  const db = ctx.getDb();
  const s = db.fivem.settings;

  if (!s.enabled) return { ok: false, reason: "disabled" };
  if (!s.statusChannelId) return { ok: false, reason: "no_channel" };

  const channel = await ctx.client.channels
    .fetch(s.statusChannelId)
    .catch(() => null);
  if (!channel || !("send" in channel))
    return { ok: false, reason: "invalid_channel" };

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(s.connectLabel || "Connect")
      .setURL(s.baseUrl ? s.baseUrl : "https://cfx.re/")
      .setDisabled(!s.baseUrl)
  );

  // Edit existing message if possible
  if (s.statusMessageId && "messages" in channel) {
    const msg = await channel.messages
      .fetch(s.statusMessageId)
      .catch(() => null);
    if (msg) {
      await msg.edit({ embeds: [embed], components: [row] }).catch(() => null);
      return { ok: true, mode: "edited" };
    }
    // message missing => reset id and send new
    s.statusMessageId = null;
  }

  const sent = await channel
    .send({ embeds: [embed], components: [row] })
    .catch(() => null);
  if (!sent) return { ok: false, reason: "send_failed" };

  s.statusMessageId = sent.id;
  await ctx.persistDb().catch(() => null);
  return { ok: true, mode: "sent" };
}

async function doPoll(ctx) {
  const db = ctx.getDb();
  const s = db.fivem.settings;
  const st = db.fivem.state;

  const now = nowMs();
  if (!s.enabled) return { ok: false, reason: "disabled" };

  if (st.nextAllowedAt && now < st.nextAllowedAt) {
    return { ok: false, reason: "backoff", nextAllowedAt: st.nextAllowedAt };
  }

  const status = await getFiveMStatus(s.baseUrl, Number(s.timeoutMs || 5000));

  st.lastCheckedAt = now;
  st.lastOnline = Boolean(status.online);

  if (status.online) {
    st.consecutiveFailures = 0;
    st.nextAllowedAt = 0;
    st.lastError = null;
    st.lastErrorAt = 0;
    st.lastSuccessAt = now;
  } else {
    st.consecutiveFailures = Number(st.consecutiveFailures || 0) + 1;
    st.lastError = status.reason || "Fetch failed/offline.";
    st.lastErrorAt = now;
    st.nextAllowedAt = now + nextBackoffMs(st.consecutiveFailures);
  }

  await ctx.persistDb().catch(() => null);

  const embed = buildStatusEmbed(ctx, status);
  await ensureStatusMessage(ctx, embed).catch(() => null);

  return { ok: true, status };
}

function hasBotAccess(interaction, config) {
  try {
    const allowed = Array.isArray(config.allowedRoleIds)
      ? config.allowedRoleIds
      : [];
    if (allowed.length === 0) {
      return interaction.memberPermissions?.has?.("ManageGuild") ?? false;
    }

    const member = interaction.member;
    const roles = member?.roles;
    const cache = roles?.cache;
    if (!cache) return false;

    return allowed.some((id) => cache.has(id));
  } catch {
    return false;
  }
}

async function handleInteraction(interaction, ctx) {
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName !== "fivem") return false;

  if (!hasBotAccess(interaction, ctx.config)) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "⛔ You do not have access to this command.",
    });
    return true;
  }

  const db = ctx.getDb();
  const s = db.fivem.settings;

  const sub = interaction.options.getSubcommand();

  if (sub === "set-endpoint") {
    const url = interaction.options.getString("url", true);
    const normalized = normalizeBaseUrl(url);
    if (!normalized) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Invalid URL. Example: http://127.0.0.1:30120",
      });
      return true;
    }
    s.baseUrl = normalized;
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Endpoint set to \`${normalized}\`.`,
    });
    return true;
  }

  if (sub === "set-channel") {
    const ch = interaction.options.getChannel("channel", true);
    s.statusChannelId = ch.id;
    // reset message id so we don't try editing a message in old channel
    s.statusMessageId = null;
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Status channel set to <#${ch.id}>.`,
    });
    return true;
  }

  if (sub === "set-interval") {
    const seconds = interaction.options.getInteger("seconds", true);
    s.checkIntervalSeconds = seconds;
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Interval set to ${seconds}s.`,
    });
    return true;
  }

  if (sub === "toggle") {
    const enabled = interaction.options.getBoolean("enabled", true);
    s.enabled = Boolean(enabled);
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ FiveM auto status is now: **${fmtBool(s.enabled)}**.`,
    });
    return true;
  }

  if (sub === "show") {
    const embed = ctx.makeEmbed(null, {
      tone: "INFO",
      title: "FiveM • Settings",
      fields: [
        { name: "Enabled", value: String(Boolean(s.enabled)), inline: true },
        {
          name: "Endpoint",
          value: s.baseUrl ? `\`${s.baseUrl}\`` : "_Not set_",
          inline: false,
        },
        {
          name: "Status Channel",
          value: s.statusChannelId ? `<#${s.statusChannelId}>` : "_Not set_",
          inline: false,
        },
        {
          name: "Interval",
          value: `${Number(s.checkIntervalSeconds || 60)}s`,
          inline: true,
        },
        {
          name: "Show Players",
          value: String(Boolean(s.showPlayers)),
          inline: true,
        },
      ],
    });

    await safeReply(interaction, { ephemeral: true, embeds: [embed] });
    return true;
  }

  if (sub === "status") {
    await safeReply(interaction, {
      ephemeral: true,
      content: "⏳ Fetching FiveM status...",
    });
    const res = await doPoll(ctx).catch((e) => ({ ok: false, err: e }));

    if (!res?.ok) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Failed to fetch status.",
      });
      return true;
    }

    const embed = buildStatusEmbed(ctx, res.status);
    await safeReply(interaction, { ephemeral: true, embeds: [embed] });
    return true;
  }

  return true;
}

function register(ctx) {
  // Auto polling loop
  let timer = null;

  const startOrRestart = () => {
    const db = ctx.getDb();
    const s = db.fivem?.settings;
    const intervalSec = Math.max(
      15,
      Math.min(Number(s?.checkIntervalSeconds || 60), 3600)
    );

    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      const latest = ctx.getDb();
      if (!latest.fivem?.settings?.enabled) return;
      doPoll(ctx).catch(() => null);
    }, intervalSec * 1000);
  };

  ctx.client.on(Events.ClientReady, async () => {
    startOrRestart();
    // First run (best-effort) if enabled
    const db = ctx.getDb();
    if (db.fivem?.settings?.enabled) {
      await doPoll(ctx).catch(() => null);
    }
  });

  // When interval changes via slash command, we restart timer by listening to interactions (simple approach):
  // The doPoll loop itself reads enabled flag; startOrRestart should be called on ready and periodically by operator.
  // If you want instant restart on interval change, we can add a small event bus later.
}

module.exports = {
  register,
  handleInteraction,
};
