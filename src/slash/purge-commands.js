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
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: [],
    });
    console.log(`Purged all GUILD commands for guild=${guildId}`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    console.log("Purged all GLOBAL commands");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
