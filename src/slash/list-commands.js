"use strict";

/* eslint-disable no-console */
require("dotenv").config();
const { REST, Routes } = require("discord.js");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function main() {
  const token = mustEnv("DISCORD_TOKEN");
  const clientId = mustEnv("DISCORD_CLIENT_ID");
  const guildId = process.env.DISCORD_GUILD_ID;

  const rest = new REST({ version: "10" }).setToken(token);

  if (guildId) {
    const cmds = await rest.get(
      Routes.applicationGuildCommands(clientId, guildId)
    );
    console.log(`Guild commands (${cmds.length}) for guild=${guildId}:`);
    for (const c of cmds) console.log(`- /${c.name} (id=${c.id})`);
  } else {
    const cmds = await rest.get(Routes.applicationCommands(clientId));
    console.log(`Global commands (${cmds.length}):`);
    for (const c of cmds) console.log(`- /${c.name} (id=${c.id})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
