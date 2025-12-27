"use strict";

const {
  Events,
  MessageFlagsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

// Discord API ephemeral flag is 1<<6 (=64). Prefer library constant if available.
const EPHEMERAL_FLAG = MessageFlagsBitField?.Flags?.Ephemeral ?? 1 << 6;

function toFlagsPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;

  // If caller already uses flags, keep it (but remove deprecated ephemeral if present)
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

function hasBotAccess(interaction, config) {
  try {
    const allowed = Array.isArray(config.allowedRoleIds)
      ? config.allowedRoleIds
      : [];
    if (allowed.length === 0) {
      return interaction.memberPermissions?.has?.("ManageGuild") ?? false;
    }

    const roles = interaction.member?.roles?.cache;
    if (!roles) return false;

    return allowed.some((id) => roles.has(id));
  } catch {
    return false;
  }
}

function withEphemeralFlags(payload) {
  if (!payload || typeof payload !== "object") return payload;

  // If caller already uses flags, do not override.
  if (payload.flags != null) {
    // ensure deprecated key is not passed
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
  // First try: flags-based (newer API style)
  const primary = toFlagsPayload(payload);

  try {
    if (interaction.deferred || interaction.replied)
      return await interaction.followUp(primary);
    return await interaction.reply(primary);
  } catch (err) {
    // Log once (do NOT leak secrets; payload has no secrets here)
    console.error(
      "[Welcome] Interaction reply failed (flags attempt):",
      err?.message ?? err
    );

    // Fallback: deprecated ephemeral boolean (older discord.js behavior)
    const fallback = { ...(payload || {}) };
    delete fallback.flags;

    try {
      if (interaction.deferred || interaction.replied)
        return await interaction.followUp(fallback);
      return await interaction.reply(fallback);
    } catch (err2) {
      console.error(
        "[Welcome] Interaction reply failed (ephemeral fallback):",
        err2?.message ?? err2
      );
      return null;
    }
  }
}

function applyTemplate(tpl, member) {
  const userTag = member.user?.tag || member.user?.username || "user";
  const server = member.guild?.name || "server";

  return (
    String(tpl || "")
      // NOTE: Keep {mention} available for content usage, but avoid using it in embed templates.
      .replaceAll("{mention}", `${member}`)
      .replaceAll("{user}", userTag)
      .replaceAll("{server}", server)
  );
}

// Strip discord mentions from a string (for embed safety).
function stripMentions(text) {
  return String(text || "")
    .replaceAll(/<@!?(\d+)>/g, "@user")
    .replaceAll(/<@&(\d+)>/g, "@role")
    .replaceAll(/<#(\d+)>/g, "#channel")
    .replaceAll(/@everyone/g, "everyone")
    .replaceAll(/@here/g, "here");
}


function buildWelcomeEmbed(ctx, member) {
  const db = ctx.getDb();
  const s = db.welcome?.settings || {};

  const title = String(s.embedTitle || "Welcome!").slice(0, 256);

  // Important: no mention inside embed. We also sanitize mentions defensively.
  const rawDesc = applyTemplate(
    s.embedDescriptionTemplate ||
      "Welcome to **{server}**! We are glad to have you.",
    member
  );
  const description = stripMentions(rawDesc).slice(0, 4000);

  const avatarUrl =
    member.user?.displayAvatarURL?.({ size: 256, extension: "png" }) ||
    member.user?.avatarURL?.({ size: 256 }) ||
    null;

  // Using your existing embed system (ctx.makeEmbed)
  const embed = ctx.makeEmbed(null, {
    tone: "INFO",
    title,
    description,
    // Thumbnail on the right (like your screenshot)
    thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
    footer: { text: `${member.guild?.name || "Server"} • Welcome` },
  });

  return embed;
}

function buildWelcomeButtonsRow(ctx) {
  const db = ctx.getDb();
  const s = db.welcome?.settings || {};
  const b = s.buttons || {};

  const row = new ActionRowBuilder();

  // Button 1
  if (b.button1Url && b.button1Label) {
    row.addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(String(b.button1Label).slice(0, 80))
        .setURL(String(b.button1Url))
    );
  }

  // Button 2
  if (b.button2Url && b.button2Label) {
    row.addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(String(b.button2Label).slice(0, 80))
        .setURL(String(b.button2Url))
    );
  }

  // If no buttons configured, return null (send without components)
  if (row.components.length === 0) return null;

  return row;
}

async function sendWelcome(ctx, member, opts = {}) {
  const db = ctx.getDb();
  const s = db.welcome?.settings;

  const force = Boolean(opts.force);
  if (!s?.enabled && !force) return;

  // Auto-role
  if (s.autoRoleId) {
    try {
      const role = await member.guild.roles
        .fetch(s.autoRoleId)
        .catch(() => null);
      if (role) {
        await member.roles.add(role, "Welcome auto-role").catch((e) => {
          console.error("[Welcome] Failed to add auto-role:", e?.message ?? e);
          return null;
        });
      }
    } catch (_) {}
  }

  // Welcome channel message
  if (s.channelId) {
    const channel = await ctx.client.channels.fetch(s.channelId).catch((e) => {
      console.error(
        "[Welcome] Failed to fetch welcome channel:",
        e?.message ?? e
      );
      return null;
    });

    if (channel && "send" in channel) {
      const embed = buildWelcomeEmbed(ctx, member);
      const row = buildWelcomeButtonsRow(ctx);

      // Mention must be outside embed, as spoiler only
      const mentionLine = `||${member}||`;

      const payload = {
        content: mentionLine,
        embeds: [embed],
        components: row ? [row] : [],
      };

      await channel.send(payload).catch((e) => {
        console.error(
          "[Welcome] Failed to send welcome message:",
          e?.message ?? e
        );
        return null;
      });
    }
  }

  // Optional DM (unchanged)
  if (s.dmEnabled) {
    const dmText = applyTemplate(
      s.dmTemplate || "Welcome to {server}!",
      member
    );
    await member.send({ content: dmText }).catch((e) => {
      console.warn("[Welcome] DM failed (likely closed):", e?.message ?? e);
      return null;
    });
  }
}

async function handleInteraction(interaction, ctx) {
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName !== "welcome") return false;

  if (!hasBotAccess(interaction, ctx.config)) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "⛔ You do not have access to this command.",
    });
    return true;
  }

  const db = ctx.getDb();
  const s = db.welcome.settings;
  const sub = interaction.options.getSubcommand();

  if (sub === "toggle") {
    const enabled = interaction.options.getBoolean("enabled", true);
    s.enabled = Boolean(enabled);
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Welcome is now: **${s.enabled ? "ON" : "OFF"}**`,
    });
    return true;
  }

  if (sub === "set-channel") {
    const ch = interaction.options.getChannel("channel", true);
    s.channelId = ch.id;
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Welcome channel set to <#${ch.id}>`,
    });
    return true;
  }

  if (sub === "set-title") {
    const title = interaction.options.getString("title", true);
    s.embedTitle = String(title).slice(0, 256);
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Welcome embed title updated.",
    });
    return true;
  }

  if (sub === "set-message") {
    const tpl = interaction.options.getString("template", true);
    s.embedDescriptionTemplate = String(tpl).slice(0, 1900);
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content:
        "✅ Welcome embed message updated. Placeholders: {user}, {server} (mentions stripped).",
    });
    return true;
  }

  if (sub === "set-buttons") {
    const label1 = interaction.options.getString("label1", true);
    const url1 = interaction.options.getString("url1", true);
    const label2 = interaction.options.getString("label2", true);
    const url2 = interaction.options.getString("url2", true);

    s.buttons ||= {};
    s.buttons.button1Label = String(label1).slice(0, 80);
    s.buttons.button1Url = String(url1).slice(0, 2048);
    s.buttons.button2Label = String(label2).slice(0, 80);
    s.buttons.button2Url = String(url2).slice(0, 2048);

    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Welcome buttons updated.",
    });
    return true;
  }

  if (sub === "set-dm") {
    const enabled = interaction.options.getBoolean("enabled", true);
    const tpl = interaction.options.getString("template", false);

    s.dmEnabled = Boolean(enabled);
    if (tpl) s.dmTemplate = String(tpl).slice(0, 1900);

    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Welcome DM is now: **${s.dmEnabled ? "ON" : "OFF"}**${
        tpl ? " (template updated)" : ""
      }`,
    });
    return true;
  }

  if (sub === "set-role") {
    const clear = interaction.options.getBoolean("clear", false) || false;
    const role = interaction.options.getRole("role", false);

    if (clear) {
      s.autoRoleId = null;
      await ctx.persistDb().catch(() => null);
      await safeReply(interaction, {
        ephemeral: true,
        content: "✅ Auto-role cleared.",
      });
      return true;
    }

    if (!role) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Provide a role or set clear=true.",
      });
      return true;
    }

    s.autoRoleId = role.id;
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Auto-role set to <@&${role.id}>`,
    });
    return true;
  }

  if (sub === "test") {
    if (!interaction.member) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Unable to resolve member.",
      });
      return true;
    }

    const db = ctx.getDb();
    const s = db.welcome?.settings;

    await safeReply(interaction, {
      ephemeral: true,
      content: "⏳ Sending test welcome...",
    });

    const member = interaction.member;

    // Force send for test, even if module is disabled (better UX)
    await sendWelcome(ctx, member, { force: true }).catch((e) => {
      console.error("[Welcome] Test send failed:", e?.message ?? e);
      return null;
    });

    const note = s?.enabled
      ? ""
      : " (note: welcome is currently disabled; test forced send)";
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Test welcome sent (best-effort)${note}.`,
    });
    return true;
  }

  if (sub === "show") {
    const embed = ctx.makeEmbed(null, {
      tone: "INFO",
      title: "Welcome • Settings",
      fields: [
        { name: "Enabled", value: String(Boolean(s.enabled)), inline: true },
        {
          name: "Channel",
          value: s.channelId ? `<#${s.channelId}>` : "_Not set_",
          inline: false,
        },
        { name: "DM", value: String(Boolean(s.dmEnabled)), inline: true },
        {
          name: "Auto-role",
          value: s.autoRoleId ? `<@&${s.autoRoleId}>` : "_None_",
          inline: false,
        },
        {
          name: "Template",
          value: `\`${String(s.messageTemplate || "").slice(0, 200)}\``,
          inline: false,
        },
      ],
    });
    await safeReply(interaction, { ephemeral: true, embeds: [embed] });
    return true;
  }

  return true;
}

function register(ctx) {
  ctx.client.on(Events.GuildMemberAdd, async (member) => {
    await sendWelcome(ctx, member).catch(() => null);
  });
}

module.exports = {
  register,
  handleInteraction,
};
