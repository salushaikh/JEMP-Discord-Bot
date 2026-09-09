import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/** Allocates a permanently unique human-facing number inside the current SQL transaction. */
export async function nextNumber(db: Db, key: string): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "SystemCounter" ("key", "nextValue", "updatedAt")
    VALUES (${key}, 2, NOW())
    ON CONFLICT ("key") DO UPDATE
      SET "nextValue" = "SystemCounter"."nextValue" + 1, "updatedAt" = NOW()
    RETURNING "nextValue" - 1 AS value
  `;
  return rows[0]!.value;
}
