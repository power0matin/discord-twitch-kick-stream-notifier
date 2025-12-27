"use strict";

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const welcome = new SlashCommandBuilder()
  .setName("welcome")
  .setDescription(
    "Welcome system: channel message, optional DM, optional auto-role."
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sc) =>
    sc
      .setName("toggle")
      .setDescription("Enable/disable welcome messages.")
      .addBooleanOption((o) =>
        o
          .setName("enabled")
          .setDescription("true = enable, false = disable")
          .setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-channel")
      .setDescription("Set welcome channel.")
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("Channel to send welcome messages to")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-title")
      .setDescription("Set welcome embed title.")
      .addStringOption((o) =>
        o.setName("title").setDescription("Embed title").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-message")
      .setDescription("Set welcome embed description template (no mention).")
      .addStringOption((o) =>
        o
          .setName("template")
          .setDescription("Use {user}, {server}. Mentions will be stripped.")
          .setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-buttons")
      .setDescription("Configure two link buttons under the welcome embed.")
      .addStringOption((o) =>
        o.setName("label1").setDescription("Button 1 label").setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("url1").setDescription("Button 1 URL").setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("label2").setDescription("Button 2 label").setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("url2").setDescription("Button 2 URL").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-dm")
      .setDescription("Enable/disable welcome DM and set template.")
      .addBooleanOption((o) =>
        o
          .setName("enabled")
          .setDescription("Send DM to new members")
          .setRequired(true)
      )
      .addStringOption((o) =>
        o
          .setName("template")
          .setDescription("Optional DM template (use {user}, {server})")
          .setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-role")
      .setDescription("Set auto-role for new members (or clear).")
      .addRoleOption((o) =>
        o
          .setName("role")
          .setDescription("Role to assign (optional)")
          .setRequired(false)
      )
      .addBooleanOption((o) =>
        o
          .setName("clear")
          .setDescription("true to clear auto-role")
          .setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc.setName("test").setDescription("Send a test welcome message.")
  )
  .addSubcommand((sc) =>
    sc.setName("show").setDescription("Show current welcome settings (safe).")
  );

module.exports = {
  commands: [welcome.toJSON()],
};
