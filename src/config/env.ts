import 'dotenv/config';
import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1).optional(),
  DATABASE_URL: z.string().url(),
  INTERNAL_API_HOST: z.string().default('127.0.0.1'),
  INTERNAL_API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  PUBLIC_BASE_URL: z.string().url().optional(),
  DATA_ENCRYPTION_KEY: z.string().min(40),
  TIMELINE_SERVICE_SECRET: z.string().min(32),
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

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  const decoded = Buffer.from(parsed.data.DATA_ENCRYPTION_KEY, 'base64');
  if (decoded.length !== 32) {
    throw new Error('DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return parsed.data;
}
