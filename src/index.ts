import { isDiscordConfigured, loadEnv } from './config/env.js';
import { createLogger, createPrisma } from './db/client.js';
import { createInternalApi } from './api/server.js';
import { createBot } from './discord/bot.js';

const env = loadEnv();
const logger = createLogger(env);
const db = createPrisma(logger);
const api = createInternalApi({ db, env, logger });
const bot = createBot({ db, env, logger });

async function main() {
  try {
    await db.$connect();
    logger.info('Connected to database successfully');
  } catch (error) {
    logger.warn({ err: error }, 'PostgreSQL database connection failed — running in fallback mode');
  }

  await api.listen({ host: env.INTERNAL_API_HOST, port: env.INTERNAL_API_PORT });
  logger.info({ host: env.INTERNAL_API_HOST, port: env.INTERNAL_API_PORT }, `JEMP API service listening on http://${env.INTERNAL_API_HOST}:${env.INTERNAL_API_PORT}`);

  if (!isDiscordConfigured(env)) {
    logger.info('DISCORD_TOKEN is not configured yet. Set DISCORD_TOKEN in settings to activate the Discord bot. API service is running.');
  } else {
    try {
      await bot.login(env.DISCORD_TOKEN);
      logger.info('Discord bot logged in successfully');
    } catch (botError) {
      logger.warn({ err: botError }, 'Discord bot login failed — please check DISCORD_TOKEN. API service remains active.');
    }
  }
}

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down JEMP');
  try {
    await bot.destroy();
  } catch {
    // ignore
  }
  try {
    await api.close();
  } catch {
    // ignore
  }
  try {
    await db.$disconnect();
  } catch {
    // ignore
  }
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

main().catch(async (error) => {
  logger.fatal({ err: error }, 'JEMP failed to start');
  await db.$disconnect();
  process.exit(1);
});
