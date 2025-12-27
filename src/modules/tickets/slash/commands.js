"use strict";

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const tickets = new SlashCommandBuilder()
  .setName("tickets")
  .setDescription("Ticket system: panel, create, close, settings.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sc) =>
    sc
      .setName("toggle")
      .setDescription("Enable/disable tickets module.")
      .addBooleanOption((o) =>
        o
          .setName("enabled")
          .setDescription("true = enable, false = disable")
          .setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-category")
      .setDescription(
        "Set ticket category (channels will be created under this category)."
      )
      .addChannelOption((o) =>
        o
          .setName("category")
          .setDescription("A Discord category")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("staff-add")
      .setDescription("Add a staff role (has access to all tickets).")
      .addRoleOption((o) =>
        o.setName("role").setDescription("Staff role").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("staff-remove")
      .setDescription("Remove a staff role.")
      .addRoleOption((o) =>
        o.setName("role").setDescription("Staff role").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc.setName("staff-clear").setDescription("Clear all staff roles.")
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-log-channel")
      .setDescription("Set log channel (optional).")
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Where ticket create/close logs will be posted")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc.setName("clear-log-channel").setDescription("Clear log channel.")
  )
  .addSubcommand((sc) =>
    sc
      .setName("panel")
      .setDescription("Create or update the ticket panel message.")
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Where the panel message should be posted")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      )
      .addStringOption((o) =>
        o
          .setName("title")
          .setDescription("Panel title (optional)")
          .setRequired(false)
      )
      .addStringOption((o) =>
        o
          .setName("description")
          .setDescription("Panel description (optional)")
          .setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("close")
      .setDescription("Close the current ticket (use inside a ticket channel).")
  )
  .addSubcommand((sc) =>
    sc.setName("show").setDescription("Show current tickets settings (safe).")
  );

module.exports = {
  commands: [tickets.toJSON()],
};
