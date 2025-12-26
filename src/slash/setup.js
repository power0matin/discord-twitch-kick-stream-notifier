"use strict";

const crypto = require("crypto");

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ComponentType,
  EmbedBuilder,
  ModalBuilder,
  Routes,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
} = require("discord.js");

const { config } = require("../config");
const { loadDb, saveDb } = require("../storage");

// In-memory session store (14 min TTL, aligned with interaction token validity)
const SESSIONS = new Map();
const SESSION_TTL_MS = 14 * 60 * 1000;

function now() {
  return Date.now();
}

function makeSessionId() {
  return crypto.randomBytes(8).toString("hex");
}

function keyOf(interaction) {
  return `${interaction.guildId}:${interaction.user.id}`;
}

function normalizeName(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function truncate(str, max) {
  const s = safeStr(str);
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function compileRegexOrNull(pattern) {
  const p = String(pattern ?? "").trim();
  if (!p) return null;
  if (p.length > 200) return null;
  try {
    return new RegExp(p, "i");
  } catch {
    return null;
  }
}

async function hasBotAccessInteraction(interaction) {
  try {
    const allowed = Array.isArray(config.allowedRoleIds)
      ? config.allowedRoleIds
      : [];

    // If roles not configured -> fallback to ManageGuild
    if (allowed.length === 0) {
      return (
        interaction.memberPermissions?.has(
          PermissionsBitField.Flags.ManageGuild
        ) ?? false
      );
    }

    const member = interaction.member; // GuildMember
    if (!member?.roles?.cache) return false;

    return allowed.some((roleId) => member.roles.cache.has(roleId));
  } catch {
    return false;
  }
}

function getDefaultDraftFromDb(db) {
  db.settings ||= {};
  return {
    notifyChannelId: db.settings.notifyChannelId || "",
    mentionHere: Boolean(db.settings.mentionHere),
    keywordRegex: String(db.settings.keywordRegex || ""),
    checkIntervalSeconds: Number(db.settings.checkIntervalSeconds || 60),
    discoveryMode: Boolean(db.settings.discoveryMode),

    discoveryTwitchPages: Number(db.settings.discoveryTwitchPages || 5),
    discoveryKickLimit: Number(db.settings.discoveryKickLimit || 100),

    twitchGta5GameId: String(db.settings.twitchGta5GameId || "32982"),
    kickGtaCategoryName: String(db.settings.kickGtaCategoryName || "GTA V"),
  };
}

function formatBool(v) {
  return v ? "on" : "off";
}

function fmtChannel(chId) {
  return chId ? `<#${chId}>` : "`(not set)`";
}

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(x)));
}

async function validateDraft(client, guild, draft) {
  const issues = [];

  // Channel validation
  if (!draft.notifyChannelId) {
    issues.push("Notify channel is not set.");
  } else {
    const ch = await client.channels
      .fetch(draft.notifyChannelId)
      .catch(() => null);
    if (!ch) {
      issues.push(
        "Notify channel cannot be fetched (invalid ID or missing access)."
      );
    } else {
      const badType =
        ch.type === ChannelType.DM || ch.type === ChannelType.GroupDM;
      if (badType) {
        issues.push(
          "Notify channel must be a guild text/announcement channel (not DM)."
        );
      }
      if (!("send" in ch)) {
        issues.push("Notify channel is not sendable by the bot.");
      }

      // Permission check (guild-based)
      const me = guild?.members?.me || null;
      if (me && "permissionsFor" in ch) {
        const perms = ch.permissionsFor(me);
        if (!perms?.has(PermissionsBitField.Flags.ViewChannel)) {
          issues.push(
            "Bot lacks ViewChannel permission in the notify channel."
          );
        }
        if (!perms?.has(PermissionsBitField.Flags.SendMessages)) {
          issues.push(
            "Bot lacks SendMessages permission in the notify channel."
          );
        }
      }
    }
  }

  // Regex validation (allow empty -> will fallback at runtime, but show warning)
  if (!safeStr(draft.keywordRegex)) {
    issues.push(
      "Regex is empty (bot will fallback to default, but this is usually unintended)."
    );
  } else {
    const re = compileRegexOrNull(draft.keywordRegex);
    if (!re) issues.push("Regex pattern is invalid (cannot compile).");
  }

  // Interval
  const interval = clampInt(draft.checkIntervalSeconds, 10, 3600, 60);
  if (interval !== Number(draft.checkIntervalSeconds)) {
    issues.push(
      "Interval was out of range; it will be clamped to 10..3600 on save."
    );
  }

  // Advanced ranges (soft validation)
  const pages = clampInt(draft.discoveryTwitchPages, 1, 50, 5);
  if (pages !== Number(draft.discoveryTwitchPages)) {
    issues.push("discoveryTwitchPages will be clamped to 1..50 on save.");
  }
  const limit = clampInt(draft.discoveryKickLimit, 1, 100, 100);
  if (limit !== Number(draft.discoveryKickLimit)) {
    issues.push("discoveryKickLimit will be clamped to 1..100 on save.");
  }

  return issues;
}

function buildEmbed(interaction, draft, issues, mode) {
  const t = mode === "advanced" ? "Setup Wizard • Advanced" : "Setup Wizard";
  const e = new EmbedBuilder().setColor(0x5865f2).setTitle(t);

  e.setDescription(
    [
      "Use the controls below to configure the bot.",
      "This session expires automatically in ~14 minutes.",
    ].join("\n")
  );

  e.addFields(
    {
      name: "Notify Channel",
      value: `${fmtChannel(draft.notifyChannelId)}\n\`${
        draft.notifyChannelId || "-"
      }\``,
      inline: false,
    },
    {
      name: "@here",
      value: `**${formatBool(Boolean(draft.mentionHere))}**`,
      inline: true,
    },
    {
      name: "Interval",
      value: `**${clampInt(draft.checkIntervalSeconds, 10, 3600, 60)}s**`,
      inline: true,
    },
    {
      name: "Regex",
      value: `\`${truncate(safeStr(draft.keywordRegex) || "(empty)", 120)}\``,
      inline: false,
    },
    {
      name: "Discovery",
      value: `**${formatBool(Boolean(draft.discoveryMode))}**`,
      inline: true,
    }
  );

  if (mode === "advanced") {
    e.addFields(
      {
        name: "Discovery Limits",
        value:
          `Twitch pages: **${clampInt(
            draft.discoveryTwitchPages,
            1,
            50,
            5
          )}**\n` +
          `Kick limit: **${clampInt(draft.discoveryKickLimit, 1, 100, 100)}**`,
        inline: true,
      },
      {
        name: "Filters",
        value:
          `Twitch game_id: **${
            truncate(safeStr(draft.twitchGta5GameId), 40) || "-"
          }**\n` +
          `Kick category: **${
            truncate(safeStr(draft.kickGtaCategoryName), 60) || "-"
          }**`,
        inline: true,
      }
    );
  }

  if (issues.length) {
    e.addFields({
      name: "Validation",
      value: issues.map((x) => `• ${truncate(x, 200)}`).join("\n"),
      inline: false,
    });
  } else {
    e.addFields({
      name: "Validation",
      value: "• All checks passed.",
      inline: false,
    });
  }

  e.setFooter({
    text: `${interaction.user.tag}${
      interaction.guild?.name ? ` • ${interaction.guild.name}` : ""
    }`,
  });

  e.setTimestamp(new Date());
  return e;
}

function cid(sessionId, action) {
  return `setup:${sessionId}:${action}`;
}

function buildComponents(sessionId, draft, issues, mode) {
  const canSave = issues.length === 0;

  // Row 1: core settings
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(cid(sessionId, "channel"))
      .setLabel("Channel")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(cid(sessionId, "toggle_here"))
      .setLabel(`@here: ${formatBool(Boolean(draft.mentionHere))}`)
      .setStyle(
        Boolean(draft.mentionHere) ? ButtonStyle.Success : ButtonStyle.Secondary
      ),
    new ButtonBuilder()
      .setCustomId(cid(sessionId, "regex"))
      .setLabel("Regex")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(cid(sessionId, "interval"))
      .setLabel("Interval")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(cid(sessionId, "toggle_discovery"))
      .setLabel(`Discovery: ${formatBool(Boolean(draft.discoveryMode))}`)
      .setStyle(
        Boolean(draft.discoveryMode)
          ? ButtonStyle.Success
          : ButtonStyle.Secondary
      )
  );

  // Row 2: advanced + test + save/cancel
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(
        cid(sessionId, mode === "advanced" ? "basic_view" : "advanced_view")
      )
      .setLabel(mode === "advanced" ? "Basic" : "Advanced")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cid(sessionId, "test"))
      .setLabel("Test Notify")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cid(sessionId, "reset"))
      .setLabel("Reset")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cid(sessionId, "save"))
      .setLabel(canSave ? "Save" : "Save (fix issues)")
      .setStyle(canSave ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!canSave),
    new ButtonBuilder()
      .setCustomId(cid(sessionId, "cancel"))
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
  );

  // Row 3: advanced modal (only visible in advanced mode)
  const rows = [row1, row2];

  if (mode === "advanced") {
    const row3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(cid(sessionId, "advanced_modal"))
        .setLabel("Edit Advanced Settings")
        .setStyle(ButtonStyle.Primary)
    );
    rows.push(row3);
  }

  return rows;
}

function buildChannelPicker(sessionId, currentChannelId) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(cid(sessionId, "channel_select"))
    .setPlaceholder("Select notify channel…")
    // Limit to common "sendable" guild channels
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);

  const row = new ActionRowBuilder().addComponents(select);

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(cid(sessionId, "channel_use_here"))
      .setLabel("Use this channel")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!currentChannelId),
    new ButtonBuilder()
      .setCustomId(cid(sessionId, "back"))
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary)
  );

  return [row, row2];
}

function buildRegexModal(sessionId, currentValue) {
  const modal = new ModalBuilder()
    .setCustomId(cid(sessionId, "modal_regex"))
    .setTitle("Set Regex (case-insensitive)");

  const input = new TextInputBuilder()
    .setCustomId("regex")
    .setLabel("Regex pattern")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(200)
    .setValue(safeStr(currentValue) || "nox\\s*rp");

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildIntervalModal(sessionId, currentValue) {
  const modal = new ModalBuilder()
    .setCustomId(cid(sessionId, "modal_interval"))
    .setTitle("Set Interval (seconds)");

  const input = new TextInputBuilder()
    .setCustomId("interval")
    .setLabel("Interval (10..3600)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(4)
    .setValue(String(clampInt(currentValue, 10, 3600, 60)));

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildAdvancedModal(sessionId, draft) {
  const modal = new ModalBuilder()
    .setCustomId(cid(sessionId, "modal_advanced"))
    .setTitle("Advanced Settings");

  const twitchPages = new TextInputBuilder()
    .setCustomId("discoveryTwitchPages")
    .setLabel("Discovery Twitch pages (1..50)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(2)
    .setValue(String(clampInt(draft.discoveryTwitchPages, 1, 50, 5)));

  const kickLimit = new TextInputBuilder()
    .setCustomId("discoveryKickLimit")
    .setLabel("Discovery Kick limit (1..100)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(3)
    .setValue(String(clampInt(draft.discoveryKickLimit, 1, 100, 100)));

  const twitchGameId = new TextInputBuilder()
    .setCustomId("twitchGta5GameId")
    .setLabel("Twitch game_id (GTA5 default: 32982)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(32)
    .setValue(safeStr(draft.twitchGta5GameId) || "32982");

  const kickCategoryName = new TextInputBuilder()
    .setCustomId("kickGtaCategoryName")
    .setLabel("Kick category name")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80)
    .setValue(safeStr(draft.kickGtaCategoryName) || "GTA V");

  modal.addComponents(
    new ActionRowBuilder().addComponents(twitchPages),
    new ActionRowBuilder().addComponents(kickLimit),
    new ActionRowBuilder().addComponents(twitchGameId),
    new ActionRowBuilder().addComponents(kickCategoryName)
  );

  return modal;
}

function getSessionById(sessionId) {
  for (const s of SESSIONS.values()) {
    if (s.sessionId === sessionId) return s;
  }
  return null;
}

function cleanupExpiredSessions() {
  const t = now();
  for (const [k, s] of SESSIONS.entries()) {
    if (t > s.expiresAt) SESSIONS.delete(k);
  }
}

async function editOriginalEphemeralPanel(client, session, payload) {
  // Requires the token from the ORIGINAL /setup interaction.
  const appId = client.application?.id || client.user?.id;
  if (!appId || !session.panelToken) return false;

  const route = Routes.webhookMessage(appId, session.panelToken, "@original");
  await client.rest.patch(route, { body: payload });
  return true;
}

async function bestEffortCleanupActiveMessagesInOldChannel(
  client,
  db,
  oldChannelId
) {
  if (!oldChannelId) return;

  const ch = await client.channels.fetch(oldChannelId).catch(() => null);
  if (!ch || !("messages" in ch)) return;

  const ids = [];
  const kickActive = db.state?.kickActiveMessages || {};
  const twitchActive = db.state?.twitchActiveMessages || {};

  for (const k of Object.keys(kickActive)) {
    if (kickActive[k]?.messageId) ids.push(kickActive[k].messageId);
  }
  for (const k of Object.keys(twitchActive)) {
    if (twitchActive[k]?.messageId) ids.push(twitchActive[k].messageId);
  }

  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    await ch.messages.delete(id).catch(() => null);
  }
}

async function renderAndUpdatePanel(
  interactionOrClient,
  session,
  interactionForContext
) {
  const client = interactionOrClient?.client || interactionOrClient; // allow passing interaction or client

  const interaction = interactionForContext || interactionOrClient;

  const guild = interaction.guild;
  const issues = await validateDraft(client, guild, session.draft);
  const embed = buildEmbed(interaction, session.draft, issues, session.mode);

  const components = buildComponents(
    session.sessionId,
    session.draft,
    issues,
    session.mode
  );

  const payload = { embeds: [embed], components };

  // Prefer editing the original ephemeral panel via webhook token
  await editOriginalEphemeralPanel(client, session, payload).catch(() => null);

  return { issues };
}

async function startWizard(interaction) {
  cleanupExpiredSessions();

  if (!(await hasBotAccessInteraction(interaction))) {
    await interaction.reply({
      ephemeral: true,
      content: "❌ You don't have permission to run setup.",
    });
    return;
  }

  const db = await loadDb();
  const draft = getDefaultDraftFromDb(db);

  const sessionId = makeSessionId();
  const k = keyOf(interaction);

  SESSIONS.set(k, {
    sessionId,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    panelToken: interaction.token, // critical for updating ephemeral panel after modals
    createdAt: now(),
    expiresAt: now() + SESSION_TTL_MS,
    mode: "basic",
    dbSnapshot: db, // optional snapshot for reset
    draft,
  });

  await interaction.deferReply({ ephemeral: true });

  const session = SESSIONS.get(k);
  const issues = await validateDraft(
    interaction.client,
    interaction.guild,
    session.draft
  );
  const embed = buildEmbed(interaction, session.draft, issues, session.mode);

  await interaction.editReply({
    embeds: [embed],
    components: buildComponents(sessionId, session.draft, issues, session.mode),
  });
}

async function showConfig(interaction) {
  if (!(await hasBotAccessInteraction(interaction))) {
    await interaction.reply({
      ephemeral: true,
      content: "❌ You don't have permission to view config.",
    });
    return;
  }

  const db = await loadDb();
  const s = getDefaultDraftFromDb(db);

  const e = new EmbedBuilder()
    .setColor(0x2f3136)
    .setTitle("Configuration")
    .setDescription("Current runtime settings (safe).")
    .addFields(
      {
        name: "Notify Channel",
        value: `${fmtChannel(s.notifyChannelId)}\n\`${
          s.notifyChannelId || "-"
        }\``,
        inline: false,
      },
      {
        name: "@here",
        value: `**${formatBool(s.mentionHere)}**`,
        inline: true,
      },
      {
        name: "Interval",
        value: `**${clampInt(s.checkIntervalSeconds, 10, 3600, 60)}s**`,
        inline: true,
      },
      {
        name: "Regex",
        value: `\`${truncate(s.keywordRegex || "(empty)", 200)}\``,
        inline: false,
      },
      {
        name: "Discovery",
        value: `**${formatBool(s.discoveryMode)}**`,
        inline: true,
      },
      {
        name: "Discovery Twitch pages",
        value: `**${clampInt(s.discoveryTwitchPages, 1, 50, 5)}**`,
        inline: true,
      },
      {
        name: "Discovery Kick limit",
        value: `**${clampInt(s.discoveryKickLimit, 1, 100, 100)}**`,
        inline: true,
      },
      {
        name: "Twitch game_id",
        value: `\`${truncate(s.twitchGta5GameId, 64)}\``,
        inline: true,
      },
      {
        name: "Kick category name",
        value: `\`${truncate(s.kickGtaCategoryName, 64)}\``,
        inline: true,
      }
    )
    .setFooter({
      text: `${interaction.user.tag}${
        interaction.guild?.name ? ` • ${interaction.guild.name}` : ""
      }`,
    })
    .setTimestamp(new Date());

  await interaction.reply({ ephemeral: true, embeds: [e] });
}

async function testNotify(interaction) {
  if (!(await hasBotAccessInteraction(interaction))) {
    await interaction.reply({
      ephemeral: true,
      content: "❌ You don't have permission to run test.",
    });
    return;
  }

  const db = await loadDb();
  const s = getDefaultDraftFromDb(db);

  if (!s.notifyChannelId) {
    await interaction.reply({
      ephemeral: true,
      content: "⚠️ Notify channel is not set. Run `/setup wizard` first.",
    });
    return;
  }

  const ch = await interaction.client.channels
    .fetch(s.notifyChannelId)
    .catch(() => null);
  if (!ch || !("send" in ch)) {
    await interaction.reply({
      ephemeral: true,
      content:
        "❌ Cannot send to notify channel (invalid channel or missing access).",
    });
    return;
  }

  const mentionHere = Boolean(s.mentionHere);
  const allowedMentions = { parse: mentionHere ? ["everyone"] : [] };

  const sent = await ch
    .send({
      content: `${
        mentionHere ? "@here " : ""
      }ℹ️ **Test notification**\nIf you see this, the bot can post here.`,
      allowedMentions,
    })
    .then(() => true)
    .catch(() => false);

  await interaction.reply({
    ephemeral: true,
    content: sent
      ? "✅ Test notification sent."
      : "❌ Failed to send test notification.",
  });
}

async function handleChatInput(interaction) {
  const sub = interaction.options.getSubcommand(true);
  if (sub === "wizard") return startWizard(interaction);
  if (sub === "show") return showConfig(interaction);
  if (sub === "test") return testNotify(interaction);
}

async function handleComponent(interaction) {
  cleanupExpiredSessions();

  const id = interaction.customId || "";
  if (!id.startsWith("setup:")) return;

  const parts = id.split(":");
  const sessionId = parts[1] || "";
  const action = parts[2] || "";

  const session = getSessionById(sessionId);
  if (!session) {
    await interaction.reply({
      ephemeral: true,
      content: "⚠️ This setup session expired. Run `/setup wizard` again.",
    });
    return;
  }

  // Only allow the creator to interact
  if (
    interaction.user.id !== session.userId ||
    interaction.guildId !== session.guildId
  ) {
    await interaction.reply({
      ephemeral: true,
      content: "❌ This setup session belongs to another admin.",
    });
    return;
  }

  // Refresh expiry on activity
  session.expiresAt = now() + SESSION_TTL_MS;

  if (interaction.isButton()) {
    if (action === "cancel") {
      await interaction.deferUpdate().catch(() => null);
      await editOriginalEphemeralPanel(interaction.client, session, {
        content: "Cancelled.",
        embeds: [],
        components: [],
      }).catch(() => null);

      // Remove session
      SESSIONS.delete(keyOf(interaction));
      return;
    }

    if (action === "reset") {
      // Reload fresh DB snapshot
      const db = await loadDb();
      session.dbSnapshot = db;
      session.draft = getDefaultDraftFromDb(db);
      await interaction.deferUpdate().catch(() => null);
      await renderAndUpdatePanel(interaction, session, interaction);
      return;
    }

    if (action === "basic_view") {
      session.mode = "basic";
      await interaction.deferUpdate().catch(() => null);
      await renderAndUpdatePanel(interaction, session, interaction);
      return;
    }

    if (action === "advanced_view") {
      session.mode = "advanced";
      await interaction.deferUpdate().catch(() => null);
      await renderAndUpdatePanel(interaction, session, interaction);
      return;
    }

    if (action === "toggle_here") {
      session.draft.mentionHere = !Boolean(session.draft.mentionHere);
      await interaction.deferUpdate().catch(() => null);
      await renderAndUpdatePanel(interaction, session, interaction);
      return;
    }

    if (action === "toggle_discovery") {
      session.draft.discoveryMode = !Boolean(session.draft.discoveryMode);
      await interaction.deferUpdate().catch(() => null);
      await renderAndUpdatePanel(interaction, session, interaction);
      return;
    }

    if (action === "channel") {
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("Select Notify Channel")
            .setDescription(
              "Pick a channel for notifications, or use the current channel."
            )
            .setFooter({
              text: `${interaction.user.tag}${
                interaction.guild?.name ? ` • ${interaction.guild.name}` : ""
              }`,
            })
            .setTimestamp(new Date()),
        ],
        components: buildChannelPicker(
          session.sessionId,
          interaction.channelId
        ),
      });
      return;
    }

    if (action === "channel_use_here") {
      session.draft.notifyChannelId = interaction.channelId || "";
      await interaction.deferUpdate().catch(() => null);
      await renderAndUpdatePanel(interaction, session, interaction);
      return;
    }

    if (action === "back") {
      await interaction.deferUpdate().catch(() => null);
      await renderAndUpdatePanel(interaction, session, interaction);
      return;
    }

    if (action === "regex") {
      await interaction.showModal(
        buildRegexModal(session.sessionId, session.draft.keywordRegex)
      );
      return;
    }

    if (action === "interval") {
      await interaction.showModal(
        buildIntervalModal(
          session.sessionId,
          session.draft.checkIntervalSeconds
        )
      );
      return;
    }

    if (action === "advanced_modal") {
      await interaction.showModal(
        buildAdvancedModal(session.sessionId, session.draft)
      );
      return;
    }

    if (action === "test") {
      await interaction.deferReply({ ephemeral: true }).catch(() => null);

      const draft = session.draft;
      if (!draft.notifyChannelId) {
        await interaction.editReply("⚠️ Set a notify channel first.");
        return;
      }

      const ch = await interaction.client.channels
        .fetch(draft.notifyChannelId)
        .catch(() => null);
      if (!ch || !("send" in ch)) {
        await interaction.editReply(
          "❌ Cannot send to that channel (invalid or missing access)."
        );
        return;
      }

      const mentionHere = Boolean(draft.mentionHere);
      const allowedMentions = { parse: mentionHere ? ["everyone"] : [] };

      const ok = await ch
        .send({
          content: `${
            mentionHere ? "@here " : ""
          }ℹ️ **Setup test**\nPanel draft can post here successfully.`,
          allowedMentions,
        })
        .then(() => true)
        .catch(() => false);

      await interaction.editReply(
        ok ? "✅ Test sent." : "❌ Failed to send test."
      );
      return;
    }

    if (action === "save") {
      await interaction.deferReply({ ephemeral: true }).catch(() => null);

      const db = await loadDb();
      const oldChannelId = db.settings?.notifyChannelId || "";

      // Clamp & validate at save time
      const draft = session.draft;
      draft.checkIntervalSeconds = clampInt(
        draft.checkIntervalSeconds,
        10,
        3600,
        60
      );
      draft.discoveryTwitchPages = clampInt(
        draft.discoveryTwitchPages,
        1,
        50,
        5
      );
      draft.discoveryKickLimit = clampInt(
        draft.discoveryKickLimit,
        1,
        100,
        100
      );

      const issues = await validateDraft(
        interaction.client,
        interaction.guild,
        draft
      );
      if (issues.length) {
        await interaction.editReply(
          `❌ Cannot save yet:\n${issues.map((x) => `• ${x}`).join("\n")}`
        );
        // Re-render panel so Save stays disabled consistently
        await renderAndUpdatePanel(interaction, session, interaction);
        return;
      }

      // Apply to DB
      db.settings ||= {};
      db.settings.notifyChannelId = draft.notifyChannelId;
      db.settings.mentionHere = Boolean(draft.mentionHere);
      db.settings.keywordRegex = safeStr(draft.keywordRegex);
      db.settings.checkIntervalSeconds = draft.checkIntervalSeconds;
      db.settings.discoveryMode = Boolean(draft.discoveryMode);

      db.settings.discoveryTwitchPages = draft.discoveryTwitchPages;
      db.settings.discoveryKickLimit = draft.discoveryKickLimit;

      db.settings.twitchGta5GameId = safeStr(draft.twitchGta5GameId);
      db.settings.kickGtaCategoryName = safeStr(draft.kickGtaCategoryName);

      // If channel changed, cleanup old active messages best-effort and reset state mappings
      if (oldChannelId && oldChannelId !== db.settings.notifyChannelId) {
        await bestEffortCleanupActiveMessagesInOldChannel(
          interaction.client,
          db,
          oldChannelId
        );
        db.state ||= {};
        db.state.kickActiveMessages ||= {};
        db.state.twitchActiveMessages ||= {};
        db.state.kickActiveMessages = {};
        db.state.twitchActiveMessages = {};
      }

      await saveDb(db).catch(() => null);

      await interaction.editReply("✅ Saved successfully.");

      await editOriginalEphemeralPanel(interaction.client, session, {
        content: "✅ Setup completed.",
        embeds: [],
        components: [],
      }).catch(() => null);

      SESSIONS.delete(keyOf(interaction));
      return;
    }
  }

  // Channel select
  if (interaction.isChannelSelectMenu() && action === "channel_select") {
    const picked = interaction.values?.[0] || "";
    session.draft.notifyChannelId = picked;
    await interaction.deferUpdate().catch(() => null);
    await renderAndUpdatePanel(interaction, session, interaction);
    return;
  }
}

async function handleModal(interaction) {
  cleanupExpiredSessions();

  const id = interaction.customId || "";
  if (!id.startsWith("setup:")) return;

  const parts = id.split(":");
  const sessionId = parts[1] || "";
  const action = parts[2] || "";

  const session = getSessionById(sessionId);
  if (!session) {
    await interaction.reply({
      ephemeral: true,
      content: "⚠️ This setup session expired. Run `/setup wizard` again.",
    });
    return;
  }

  if (
    interaction.user.id !== session.userId ||
    interaction.guildId !== session.guildId
  ) {
    await interaction.reply({
      ephemeral: true,
      content: "❌ This setup session belongs to another admin.",
    });
    return;
  }

  session.expiresAt = now() + SESSION_TTL_MS;

  if (action === "modal_regex") {
    const v = safeStr(interaction.fields.getTextInputValue("regex"));
    session.draft.keywordRegex = v;
    await interaction
      .reply({ ephemeral: true, content: "✅ Regex updated." })
      .catch(() => null);
    await renderAndUpdatePanel(interaction.client, session, interaction);
    return;
  }

  if (action === "modal_interval") {
    const raw = safeStr(interaction.fields.getTextInputValue("interval"));
    const n = Number.parseInt(raw, 10);
    session.draft.checkIntervalSeconds = Number.isFinite(n)
      ? n
      : session.draft.checkIntervalSeconds;
    await interaction
      .reply({ ephemeral: true, content: "✅ Interval updated." })
      .catch(() => null);
    await renderAndUpdatePanel(interaction.client, session, interaction);
    return;
  }

  if (action === "modal_advanced") {
    const tp = Number.parseInt(
      safeStr(interaction.fields.getTextInputValue("discoveryTwitchPages")),
      10
    );
    const kl = Number.parseInt(
      safeStr(interaction.fields.getTextInputValue("discoveryKickLimit")),
      10
    );
    const gid = safeStr(
      interaction.fields.getTextInputValue("twitchGta5GameId")
    );
    const kn = safeStr(
      interaction.fields.getTextInputValue("kickGtaCategoryName")
    );

    if (Number.isFinite(tp)) session.draft.discoveryTwitchPages = tp;
    if (Number.isFinite(kl)) session.draft.discoveryKickLimit = kl;
    session.draft.twitchGta5GameId = gid;
    session.draft.kickGtaCategoryName = kn;

    await interaction
      .reply({ ephemeral: true, content: "✅ Advanced settings updated." })
      .catch(() => null);
    await renderAndUpdatePanel(interaction.client, session, interaction);
    return;
  }
}

async function handleSetupInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName !== "setup") return false;
    await handleChatInput(interaction);
    return true;
  }

  if (interaction.isModalSubmit()) {
    if (!String(interaction.customId || "").startsWith("setup:")) return false;
    await handleModal(interaction);
    return true;
  }

  if (interaction.isButton() || interaction.isAnySelectMenu()) {
    if (!String(interaction.customId || "").startsWith("setup:")) return false;
    await handleComponent(interaction);
    return true;
  }

  return false;
}

module.exports = {
  handleSetupInteraction,
};
