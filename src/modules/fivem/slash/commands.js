"use strict";

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const fivem = new SlashCommandBuilder()
  .setName("fivem")
  .setDescription("FiveM server status & auto-updater.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sc) =>
    sc
      .setName("set-endpoint")
      .setDescription("Set server base URL (e.g. http://127.0.0.1:30120).")
      .addStringOption((o) =>
        o
          .setName("url")
          .setDescription("Base URL without trailing slash.")
          .setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-channel")
      .setDescription("Set the status channel (for auto status message).")
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Channel to post/edit the status message in.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-interval")
      .setDescription("Set auto update interval (seconds).")
      .addIntegerOption((o) =>
        o
          .setName("seconds")
          .setDescription("Recommended: 30-300")
          .setMinValue(15)
          .setMaxValue(3600)
          .setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("toggle")
      .setDescription("Enable/disable FiveM auto status.")
      .addBooleanOption((o) =>
        o
          .setName("enabled")
          .setDescription("true = enable, false = disable")
          .setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("status")
      .setDescription(
        "Fetch and show current FiveM status (and update message if enabled)."
      )
  )
  .addSubcommand((sc) =>
    sc.setName("show").setDescription("Show current FiveM settings (safe).")
  );

module.exports = {
  commands: [fivem.toJSON()],
};
