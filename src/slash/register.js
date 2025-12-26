"use strict";

require("dotenv").config();

const { REST, Routes } = require("discord.js");
const { commands } = require("./commands");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing env: ${name}`);
  }
  return v;
}

async function main() {
  const token = mustEnv("DISCORD_TOKEN");
  const clientId = mustEnv("DISCORD_CLIENT_ID");
  const guildId = process.env.DISCORD_GUILD_ID || "";

  const rest = new REST({ version: "10" }).setToken(token);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });
    console.log(`[Slash] Registered guild commands for guild=${guildId}`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log("[Slash] Registered global commands (may take time to appear)");
  }
}

main().catch((err) => {
  console.error("[Slash:Register] Fatal:", err?.message ?? err);
  process.exitCode = 1;
});
