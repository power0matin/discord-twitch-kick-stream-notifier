"use strict";

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const setup = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Interactive setup wizard for Stream Notifier bot.")
  // We still enforce access via allowedRoleIds/ManageGuild in code,
  // but this improves UX in Discord UI.
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sc) =>
    sc.setName("wizard").setDescription("Open the interactive setup wizard.")
  )
  .addSubcommand((sc) =>
    sc.setName("show").setDescription("Show current configuration (safe).")
  )
  .addSubcommand((sc) =>
    sc
      .setName("test")
      .setDescription("Send a test notification to the configured channel.")
  );

module.exports = {
  commands: [setup.toJSON()],
};
