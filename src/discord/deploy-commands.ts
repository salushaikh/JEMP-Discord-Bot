import { REST, Routes } from 'discord.js';
import { loadEnv } from '../config/env.js';
import { commandDefinitions } from './commands.js';

const env = loadEnv();
const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
const route = env.DISCORD_GUILD_ID
  ? Routes.applicationGuildCommands(env.DISCORD_APPLICATION_ID, env.DISCORD_GUILD_ID)
  : Routes.applicationCommands(env.DISCORD_APPLICATION_ID);

await rest.put(route, { body: commandDefinitions });
console.log(`Registered ${commandDefinitions.length} JEMP command groups ${env.DISCORD_GUILD_ID ? 'for the configured development guild' : 'globally'}.`);
