import { loadEnv } from './config/env.js';
import { createLogger, createPrisma } from './db/client.js';
import { createInternalApi } from './api/server.js';
import { createBot } from './discord/bot.js';

const env = loadEnv();
const logger = createLogger(env);
const db = createPrisma(logger);
const api = createInternalApi({ db, env, logger });
const bot = createBot({ db, env, logger });

async function main() {
  await db.$connect();
  await api.listen({ host: env.INTERNAL_API_HOST, port: env.INTERNAL_API_PORT });
  await bot.login(env.DISCORD_TOKEN);
}

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down JEMP');
  await bot.destroy();
  await api.close();
  await db.$disconnect();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

main().catch(async (error) => {
  logger.fatal({ err: error }, 'JEMP failed to start');
  await db.$disconnect();
  process.exit(1);
});
