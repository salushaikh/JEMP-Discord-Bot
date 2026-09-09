import 'dotenv/config';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const defaultEncryptionKey = Buffer.alloc(32, 7).toString('base64');
const defaultPort = Number(process.env.PORT) || 3000;

function normalizeKey(key: string | undefined): string {
  if (!key) return defaultEncryptionKey;
  try {
    const buf = Buffer.from(key, 'base64');
    if (buf.length === 32) return key;
  } catch {
    // fallback
  }
  return createHash('sha256').update(key).digest('base64');
}

function normalizeSecret(secret: string | undefined): string {
  if (!secret) return 'jemp_timeline_service_secret_32_chars_long';
  if (secret.length >= 32) return secret;
  return createHash('sha256').update(secret).digest('hex');
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DISCORD_TOKEN: z.string().default('placeholder-discord-token'),
  DISCORD_APPLICATION_ID: z.string().default('placeholder-app-id'),
  DISCORD_GUILD_ID: z.string().min(1).optional(),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/jemp'),
  INTERNAL_API_HOST: z.string().default('0.0.0.0'),
  INTERNAL_API_PORT: z.coerce.number().int().min(1).max(65535).default(defaultPort),
  PUBLIC_BASE_URL: z.string().url().optional(),
  DATA_ENCRYPTION_KEY: z.string().default(defaultEncryptionKey),
  TIMELINE_SERVICE_SECRET: z.string().default('jemp_timeline_service_secret_32_chars_long'),
  VERIFY_ME_CHANNEL_ID: z.string().min(1).optional(),
  PROFILE_MANAGER_CHANNEL_ID: z.string().min(1).optional(),
  APPLICATIONS_CHANNEL_ID: z.string().min(1).optional(),
  ONBOARDING_LOG_CHANNEL_ID: z.string().min(1).optional(),
  ADMIN_LOG_CHANNEL_ID: z.string().min(1).optional(),
  BOT_LOG_CHANNEL_ID: z.string().min(1).optional(),
  BRAINSTORM_HUB_CHANNEL_ID: z.string().min(1).optional(),
  PROJECT_HUB_CHANNEL_ID: z.string().min(1).optional(),
  OPPORTUNITIES_CHANNEL_ID: z.string().min(1).optional(),
  PAYROLL_CHANNEL_ID: z.string().min(1).optional(),
  UNVERIFIED_ROLE_ID: z.string().min(1).optional(),
  MEMBER_ROLE_ID: z.string().min(1).optional(),
  SUSPENDED_ROLE_ID: z.string().min(1).optional(),
  TERMINATED_ROLE_ID: z.string().min(1).optional(),
  ADMIN_ROLE_ID: z.string().min(1).optional(),
  MAX_EMAIL_VERIFICATION_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  VERIFICATION_WINDOW_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
  PUBLIC_SHARE_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: booleanString.default('false')
});

export type Env = z.infer<typeof schema>;

export function isDiscordConfigured(env: Env): boolean {
  return Boolean(
    env.DISCORD_TOKEN &&
    !env.DISCORD_TOKEN.startsWith('placeholder-') &&
    env.DISCORD_TOKEN !== 'mock-discord-token'
  );
}

export function isDatabaseConfigured(env: Env): boolean {
  return Boolean(
    process.env.DATABASE_URL &&
    !process.env.DATABASE_URL.includes('localhost:5432')
  );
}

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const cleaned: Record<string, string | undefined> = {};
  for (const [key, val] of Object.entries(raw)) {
    cleaned[key] = typeof val === 'string' && val.trim() === '' ? undefined : val;
  }
  if (!cleaned.INTERNAL_API_PORT || cleaned.INTERNAL_API_PORT === '3001') {
    cleaned.INTERNAL_API_PORT = '3000';
  }
  if (!cleaned.INTERNAL_API_HOST || cleaned.INTERNAL_API_HOST === '127.0.0.1') {
    cleaned.INTERNAL_API_HOST = '0.0.0.0';
  }
  if (cleaned.DATA_ENCRYPTION_KEY) {
    cleaned.DATA_ENCRYPTION_KEY = normalizeKey(cleaned.DATA_ENCRYPTION_KEY);
  }
  if (cleaned.TIMELINE_SERVICE_SECRET) {
    cleaned.TIMELINE_SERVICE_SECRET = normalizeSecret(cleaned.TIMELINE_SERVICE_SECRET);
  }
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  const decoded = Buffer.from(parsed.data.DATA_ENCRYPTION_KEY, 'base64');
  if (decoded.length !== 32) {
    throw new Error('DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return parsed.data;
}
