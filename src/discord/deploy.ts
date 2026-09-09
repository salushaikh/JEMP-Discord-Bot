import { REST, Routes } from 'discord.js';
import type { Logger } from 'pino';
import { isDiscordConfigured, type Env } from '../config/env.js';
import { commandDefinitions } from './commands.js';

export async function deploySlashCommands(env: Env, logger?: Logger, guildId?: string): Promise<{ count: number; guildId?: string; scope: string }> {
  if (!isDiscordConfigured(env)) {
    logger?.info('Skipping command deployment: Discord token is not configured.');
    return { count: 0, scope: 'skipped_not_configured' };
  }

  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
  const targetGuild = guildId || env.DISCORD_GUILD_ID;

  if (targetGuild) {
    const route = Routes.applicationGuildCommands(env.DISCORD_APPLICATION_ID, targetGuild);
    await rest.put(route, { body: commandDefinitions });
    logger?.info({ guildId: targetGuild, count: commandDefinitions.length }, `Registered ${commandDefinitions.length} JEMP command groups for guild ${targetGuild}`);
    return { count: commandDefinitions.length, guildId: targetGuild, scope: 'guild' };
  }

  const route = Routes.applicationCommands(env.DISCORD_APPLICATION_ID);
  await rest.put(route, { body: commandDefinitions });
  logger?.info({ count: commandDefinitions.length }, `Registered ${commandDefinitions.length} JEMP command groups globally`);
  return { count: commandDefinitions.length, scope: 'global' };
}
