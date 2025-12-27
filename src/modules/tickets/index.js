"use strict";

const {
  Events,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const EPHEMERAL_FLAG = MessageFlags?.Ephemeral ?? 1 << 6;

const CREATE_ID = "tickets:create";
const CLOSE_ID = "tickets:close";
const CLOSE_CONFIRM_ID = "tickets:close_confirm";
const CLOSE_CANCEL_ID = "tickets:close_cancel";

function hasBotAccess(interaction, config) {
  try {
    const allowed = Array.isArray(config.allowedRoleIds)
      ? config.allowedRoleIds
      : [];
    if (allowed.length === 0) {
      return interaction.memberPermissions?.has?.("ManageGuild") ?? false;
    }

    const member = interaction.member;
    const roles = member?.roles?.cache;
    if (!roles) return false;

    return allowed.some((id) => roles.has(id));
  } catch {
    return false;
  }
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

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function sanitizeChannelName(input) {
  const s = String(input || "user").toLowerCase();
  // Discord channel names: a-z 0-9 hyphen
  return (
    s
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "ticket"
  );
}

async function logToChannel(ctx, content) {
  const db = ctx.getDb();
  const logId = db.tickets?.settings?.logChannelId;
  if (!logId) return;

  const ch = await ctx.client.channels.fetch(logId).catch(() => null);
  if (!ch || !("send" in ch)) return;
  await ch.send({ content }).catch(() => null);
}

async function createOrUpdatePanel(ctx, channel, title, description) {
  const db = ctx.getDb();
  const s = db.tickets.settings;

  const panelTitle =
    String(title || "Support Tickets").trim() || "Support Tickets";
  const panelDesc =
    String(
      description ||
        "Click the button below to create a private support ticket."
    ).trim() || "Click the button below to create a private support ticket.";

  const embed = ctx.makeEmbed(null, {
    tone: "INFO",
    title: panelTitle,
    description: panelDesc,
    fields: [
      {
        name: "Privacy",
        value: "Tickets are visible only to you and staff.",
        inline: false,
      },
    ],
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CREATE_ID)
      .setLabel("Create Ticket")
      .setStyle(ButtonStyle.Primary)
  );

  // Edit existing panel message if possible
  if (
    s.panelChannelId === channel.id &&
    s.panelMessageId &&
    "messages" in channel
  ) {
    const msg = await channel.messages
      .fetch(s.panelMessageId)
      .catch(() => null);
    if (msg) {
      await msg.edit({ embeds: [embed], components: [row] }).catch(() => null);
      return { mode: "edited", messageId: msg.id };
    }
    s.panelMessageId = null;
  }

  const sent = await channel
    .send({ embeds: [embed], components: [row] })
    .catch(() => null);
  if (!sent) return { mode: "failed", messageId: null };

  s.panelChannelId = channel.id;
  s.panelMessageId = sent.id;
  await ctx.persistDb().catch(() => null);

  return { mode: "sent", messageId: sent.id };
}

async function ensureTicketPerms(ctx, guild, channel, userId) {
  const db = ctx.getDb();
  const s = db.tickets.settings;

  const staffRoleIds = uniq(
    Array.isArray(s.staffRoleIds) ? s.staffRoleIds : []
  );
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: userId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
      ],
    },
    {
      id: ctx.client.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ManageMessages,
      ],
    },
  ];

  for (const rid of staffRoleIds) {
    overwrites.push({
      id: rid,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageMessages,
      ],
    });
  }

  await channel.permissionOverwrites.set(overwrites).catch(() => null);
}

function isTicketChannel(ctx, channelId) {
  const db = ctx.getDb();
  return Boolean(db.tickets?.state?.openByChannelId?.[channelId]);
}

function getTicketOwnerId(ctx, channelId) {
  const db = ctx.getDb();
  return db.tickets?.state?.openByChannelId?.[channelId] || null;
}

async function createTicket(ctx, interaction) {
  const db = ctx.getDb();
  const s = db.tickets.settings;
  const st = db.tickets.state;

  if (!s.enabled) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ Tickets are disabled.",
    });
    return;
  }

  if (!interaction.guild) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ Tickets only work in a server.",
    });
    return;
  }

  if (!s.categoryId) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ Ticket category not configured. Use /tickets set-category",
    });
    return;
  }

  const userId = interaction.user.id;

  // Enforce max open tickets per user (default 1)
  const maxOpen = Math.max(1, Math.min(Number(s.maxOpenPerUser || 1), 5));
  const existingChannelId = st.openByUserId[userId];

  if (existingChannelId) {
    const ch = await interaction.guild.channels
      .fetch(existingChannelId)
      .catch(() => null);
    if (ch) {
      await safeReply(interaction, {
        ephemeral: true,
        content: `⚠️ You already have an open ticket: <#${existingChannelId}>`,
      });
      return;
    }
    // channel missing => cleanup
    delete st.openByUserId[userId];
    delete st.openByChannelId[existingChannelId];
    await ctx.persistDb().catch(() => null);
  }

  const category = await interaction.guild.channels
    .fetch(s.categoryId)
    .catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) {
    await safeReply(interaction, {
      ephemeral: true,
      content:
        "❌ Configured category is invalid. Use /tickets set-category again.",
    });
    return;
  }

  await safeReply(interaction, {
    ephemeral: true,
    content: "⏳ Creating your ticket...",
  });

  const name = sanitizeChannelName(
    `${s.ticketNamePrefix || "ticket"}-${interaction.user.username}`
  );
  const channel = await interaction.guild.channels
    .create({
      name,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Ticket owner: ${userId}`,
      reason: `Ticket created by ${interaction.user.tag}`,
    })
    .catch(() => null);

  if (!channel) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ Failed to create ticket channel. Check bot permissions.",
    });
    return;
  }

  await ensureTicketPerms(ctx, interaction.guild, channel, userId);

  // Store state
  st.openByUserId[userId] = channel.id;
  st.openByChannelId[channel.id] = userId;
  await ctx.persistDb().catch(() => null);

  const embed = ctx.makeEmbed(null, {
    tone: "SUCCESS",
    title: "Ticket created",
    description: [
      `Hello ${interaction.user} — a staff member will be with you shortly.`,
      "",
      "Use the button below to close this ticket when you're done.",
    ].join("\n"),
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CLOSE_ID)
      .setLabel("Close Ticket")
      .setStyle(ButtonStyle.Danger)
  );

  await channel
    .send({
      content: `${interaction.user}`,
      embeds: [embed],
      components: [row],
    })
    .catch(() => null);

  await safeReply(interaction, {
    ephemeral: true,
    content: `✅ Ticket created: <#${channel.id}>`,
  });
  await logToChannel(
    ctx,
    `🎫 Ticket created by <@${userId}> in <#${channel.id}>`
  ).catch(() => null);
}

async function requestClose(ctx, interaction) {
  if (!interaction.guild || !interaction.channel) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ This can only be used in a server channel.",
    });
    return;
  }

  const channelId = interaction.channel.id;
  if (!isTicketChannel(ctx, channelId)) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ This channel is not a managed ticket.",
    });
    return;
  }

  const ownerId = getTicketOwnerId(ctx, channelId);
  const db = ctx.getDb();
  const allowUserClose = Boolean(db.tickets?.settings?.allowUserClose);

  const isOwner = ownerId === interaction.user.id;
  const isStaff = hasBotAccess(interaction, ctx.config);

  if (!isStaff && !(allowUserClose && isOwner)) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "⛔ You are not allowed to close this ticket.",
    });
    return;
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CLOSE_CONFIRM_ID)
      .setLabel("Confirm Close")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(CLOSE_CANCEL_ID)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );

  await safeReply(interaction, {
    ephemeral: true,
    content: "Are you sure you want to close this ticket?",
    components: [row],
  });
}

async function closeTicket(ctx, interaction) {
  if (!interaction.guild || !interaction.channel) return;

  const channelId = interaction.channel.id;
  const db = ctx.getDb();
  const st = db.tickets.state;

  const ownerId = st.openByChannelId[channelId];
  if (!ownerId) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "❌ Ticket state not found (already closed?).",
    });
    return;
  }

  // Permission check (same as requestClose)
  const allowUserClose = Boolean(db.tickets?.settings?.allowUserClose);
  const isOwner = ownerId === interaction.user.id;
  const isStaff = hasBotAccess(interaction, ctx.config);

  if (!isStaff && !(allowUserClose && isOwner)) {
    await safeReply(interaction, {
      ephemeral: true,
      content: "⛔ You are not allowed to close this ticket.",
    });
    return;
  }

  delete st.openByChannelId[channelId];
  if (st.openByUserId[ownerId] === channelId) delete st.openByUserId[ownerId];
  await ctx.persistDb().catch(() => null);

  await safeReply(interaction, {
    ephemeral: true,
    content: "✅ Closing ticket...",
  });

  await logToChannel(
    ctx,
    `🧾 Ticket closed by <@${interaction.user.id}> in <#${channelId}> (owner: <@${ownerId}>)`
  ).catch(() => null);

  // Best-effort final message and delete channel
  try {
    await interaction.channel
      .send("🔒 Ticket closed. This channel will be deleted.")
      .catch(() => null);
    setTimeout(() => {
      interaction.channel
        .delete(`Ticket closed by ${interaction.user.tag}`)
        .catch(() => null);
    }, 1500);
  } catch (_) {}
}

async function handleChatCommand(interaction, ctx) {
  const sub = interaction.options.getSubcommand();
  const db = ctx.getDb();
  const s = db.tickets.settings;

  if (sub === "toggle") {
    const enabled = interaction.options.getBoolean("enabled", true);
    s.enabled = Boolean(enabled);
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Tickets are now: **${s.enabled ? "ON" : "OFF"}**`,
    });
    return true;
  }

  if (sub === "set-category") {
    const category = interaction.options.getChannel("category", true);
    s.categoryId = category.id;
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Ticket category set to: \`${category.name}\``,
    });
    return true;
  }

  if (sub === "staff-add") {
    const role = interaction.options.getRole("role", true);
    s.staffRoleIds = uniq([...(s.staffRoleIds || []), role.id]);
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Added staff role: <@&${role.id}>`,
    });
    return true;
  }

  if (sub === "staff-remove") {
    const role = interaction.options.getRole("role", true);
    s.staffRoleIds = uniq(
      (s.staffRoleIds || []).filter((id) => id !== role.id)
    );
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Removed staff role: <@&${role.id}>`,
    });
    return true;
  }

  if (sub === "staff-clear") {
    s.staffRoleIds = [];
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Cleared staff roles.",
    });
    return true;
  }

  if (sub === "set-log-channel") {
    const ch = interaction.options.getChannel("channel", true);
    s.logChannelId = ch.id;
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Log channel set to <#${ch.id}>`,
    });
    return true;
  }

  if (sub === "clear-log-channel") {
    s.logChannelId = null;
    await ctx.persistDb().catch(() => null);
    await safeReply(interaction, {
      ephemeral: true,
      content: "✅ Log channel cleared.",
    });
    return true;
  }

  if (sub === "panel") {
    const ch = interaction.options.getChannel("channel", true);
    const title = interaction.options.getString("title", false);
    const description = interaction.options.getString("description", false);

    if (!("send" in ch)) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Invalid channel type for panel.",
      });
      return true;
    }

    const res = await createOrUpdatePanel(ctx, ch, title, description);
    if (res.mode === "failed") {
      await safeReply(interaction, {
        ephemeral: true,
        content: "❌ Failed to post panel. Check bot permissions.",
      });
      return true;
    }

    await safeReply(interaction, {
      ephemeral: true,
      content: `✅ Panel ${res.mode}. MessageId: \`${res.messageId}\``,
    });
    return true;
  }

  if (sub === "close") {
    await requestClose(ctx, interaction);
    return true;
  }

  if (sub === "show") {
    const embed = ctx.makeEmbed(null, {
      tone: "INFO",
      title: "Tickets • Settings",
      fields: [
        { name: "Enabled", value: String(Boolean(s.enabled)), inline: true },
        {
          name: "Category",
          value: s.categoryId ? `<#${s.categoryId}>` : "_Not set_",
          inline: false,
        },
        {
          name: "Staff Roles",
          value: (s.staffRoleIds || []).length
            ? s.staffRoleIds.map((id) => `<@&${id}>`).join(" ")
            : "_None_",
          inline: false,
        },
        {
          name: "Panel Channel",
          value: s.panelChannelId ? `<#${s.panelChannelId}>` : "_Not set_",
          inline: false,
        },
        {
          name: "Log Channel",
          value: s.logChannelId ? `<#${s.logChannelId}>` : "_None_",
          inline: false,
        },
      ],
    });
    await safeReply(interaction, { ephemeral: true, embeds: [embed] });
    return true;
  }

  return false;
}

async function handleInteraction(interaction, ctx) {
  // Slash command
  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "tickets"
  ) {
    if (!hasBotAccess(interaction, ctx.config)) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "⛔ You do not have access to this command.",
      });
      return true;
    }
    return await handleChatCommand(interaction, ctx);
  }

  // Button interactions
  if (interaction.isButton()) {
    if (interaction.customId === CREATE_ID) {
      await createTicket(ctx, interaction);
      return true;
    }

    if (interaction.customId === CLOSE_ID) {
      await requestClose(ctx, interaction);
      return true;
    }

    if (interaction.customId === CLOSE_CONFIRM_ID) {
      await closeTicket(ctx, interaction);
      return true;
    }

    if (interaction.customId === CLOSE_CANCEL_ID) {
      await safeReply(interaction, {
        ephemeral: true,
        content: "✅ Cancelled.",
        components: [],
      });
      return true;
    }
  }

  return false;
}

function register(ctx) {
  // Optional: cleanup missing channels on startup (best-effort)
  ctx.client.on(Events.ClientReady, async () => {
    const db = ctx.getDb();
    const st = db.tickets?.state;
    if (!st) return;

    // We keep cleanup minimal (no heavy scanning)
    // If the stored open channel is missing, we remove it lazily on next create.
  });
}

module.exports = {
  register,
  handleInteraction,
};
