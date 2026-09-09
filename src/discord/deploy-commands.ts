import { loadEnv } from '../config/env.js';
import { createLogger } from '../db/client.js';
import { deploySlashCommands } from './deploy.js';

const env = loadEnv();
const logger = createLogger(env);
const result = await deploySlashCommands(env, logger);
console.log(`Registered ${result.count} JEMP command groups (${result.scope}${result.guildId ? `: ${result.guildId}` : ''}).`);

