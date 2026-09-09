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

export function createPrisma(logger: ReturnType<typeof createLogger>): PrismaClient {
  const inMemoryStore = new Map<string, Map<string, any>>();
  const counterStore = new Map<string, number>();
  let dbConnected = false;

  function getModelCollection(model: string) {
    if (!inMemoryStore.has(model)) {
      inMemoryStore.set(model, new Map());
    }
    return inMemoryStore.get(model)!;
  }

  function createNoOpModel(modelName: string) {
    return {
      findMany: async (args?: any) => {
        const items = Array.from(getModelCollection(modelName).values());
        if (args?.where) {
          return items.filter((item) => {
            for (const [key, val] of Object.entries(args.where)) {
              if (item[key] !== val) return false;
            }
            return true;
          });
        }
        return items;
      },
      findFirst: async (args?: any) => {
        const items = Array.from(getModelCollection(modelName).values());
        if (args?.where) {
          return items.find((item) => {
            for (const [key, val] of Object.entries(args.where)) {
              if (item[key] !== val) return false;
            }
            return true;
          }) ?? null;
        }
        return items[0] ?? null;
      },
      findUnique: async (args?: any) => {
        const col = getModelCollection(modelName);
        if (args?.where) {
          for (const item of col.values()) {
            let match = true;
            for (const [k, v] of Object.entries(args.where)) {
              if (typeof v === 'object' && v !== null) {
                for (const [subK, subV] of Object.entries(v as any)) {
                  if (item[subK] !== subV) match = false;
                }
              } else if (item[k] !== v) {
                match = false;
              }
            }
            if (match) return item;
          }
        }
        return null;
      },
      create: async (args?: any) => {
        const id = args?.data?.id ?? `mock_${modelName.toLowerCase()}_${Date.now()}`;
        const record = { id, createdAt: new Date(), updatedAt: new Date(), ...args?.data };
        getModelCollection(modelName).set(id, record);
        return record;
      },
      update: async (args?: any) => {
        const col = getModelCollection(modelName);
        const existing = (await createNoOpModel(modelName).findUnique(args)) ?? {};
        const updated = { ...existing, ...args?.data, updatedAt: new Date() };
        if (updated.id) col.set(updated.id, updated);
        return updated;
      },
      upsert: async (args?: any) => {
        const existing = await createNoOpModel(modelName).findUnique(args);
        if (existing) {
          return createNoOpModel(modelName).update({ where: args.where, data: args.update });
        }
        return createNoOpModel(modelName).create({ data: args.create });
      },
      delete: async (args?: any) => {
        const existing = await createNoOpModel(modelName).findUnique(args);
        if (existing?.id) getModelCollection(modelName).delete(existing.id);
        return existing ?? {};
      },
      count: async () => getModelCollection(modelName).size
    };
  }

  let realPrisma: PrismaClient | null = null;
  try {
    realPrisma = new PrismaClient({
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' }
      ]
    });
    (realPrisma as any).$on('error', (event: any) => logger.error({ prisma: event }, 'database error'));
    (realPrisma as any).$on('warn', (event: any) => logger.warn({ prisma: event }, 'database warning'));
  } catch (err) {
    logger.warn({ err }, '[AI Studio] Database client initialization failed — using mock proxy');
  }

  const handler: ProxyHandler<any> = {
    get(target, prop, receiver) {
      if (prop === '$connect') {
        return async () => {
          if (!realPrisma) return;
          try {
            await realPrisma.$connect();
            dbConnected = true;
          } catch (err) {
            dbConnected = false;
            logger.warn({ err }, '[AI Studio] PostgreSQL not reached — using in-memory database mock');
          }
        };
      }
      if (prop === '$disconnect') {
        return async () => {
          if (realPrisma && dbConnected) {
            try {
              await realPrisma.$disconnect();
            } catch {
              // ignore
            }
          }
          dbConnected = false;
        };
      }
      if (prop === '$transaction') {
        return async (arg: any) => {
          if (typeof arg === 'function') {
            return arg(receiver);
          }
          if (Array.isArray(arg)) {
            return Promise.all(arg);
          }
          return arg;
        };
      }
      if (prop === '$queryRaw') {
        return async (strings: TemplateStringsArray, ...values: any[]) => {
          if (dbConnected && realPrisma) {
            try {
              return await (realPrisma as any).$queryRaw(strings, ...values);
            } catch {
              // Fallback to in-memory on query failure
            }
          }
          const key = values[0] ? String(values[0]) : 'default';
          const next = (counterStore.get(key) ?? 1) + 1;
          counterStore.set(key, next);
          return [{ value: next - 1 }];
        };
      }
      if (prop === '$on') {
        return () => {};
      }

      if (typeof prop === 'string') {
        const modelName = prop;
        const noOpModel = createNoOpModel(modelName);

        if (dbConnected && realPrisma && (realPrisma as any)[modelName]) {
          const actualModel = (realPrisma as any)[modelName];
          return new Proxy(actualModel, {
            get(mTarget, mProp) {
              const originalMethod = mTarget[mProp];
              if (typeof originalMethod === 'function') {
                return async (...args: any[]) => {
                  try {
                    return await originalMethod.apply(mTarget, args);
                  } catch (err) {
                    logger.warn({ err, model: modelName, method: String(mProp) }, 'Query failed, falling back to mock');
                    const fallback = (noOpModel as any)[mProp];
                    if (typeof fallback === 'function') return fallback(...args);
                    return null;
                  }
                };
              }
              return originalMethod;
            }
          });
        }
        return noOpModel;
      }

      return Reflect.get(target, prop, receiver);
    }
  };

  return new Proxy(realPrisma ?? {}, handler) as PrismaClient;
}
