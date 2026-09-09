import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import type { Env } from '../config/env.js';

export function createLogger(env: Env) {
  return pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.x-timeline-service-secret', 'req.headers.x-jemp-signature', 'email', '*.email', 'encryptedEmail'],
      censor: '[REDACTED]'
    },
    transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined
  });
}

export function createPrisma(logger: ReturnType<typeof createLogger>) {
  const prisma = new PrismaClient({
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' }
    ]
  });
  prisma.$on('error', (event) => logger.error({ prisma: event }, 'database error'));
  prisma.$on('warn', (event) => logger.warn({ prisma: event }, 'database warning'));
  return prisma;
}
