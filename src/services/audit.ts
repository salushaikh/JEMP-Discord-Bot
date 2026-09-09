import { AuditAction, EntityKind, type PrismaClient } from '@prisma/client';

export type AuditInput = {
  action: AuditAction;
  actorMemberId?: string;
  actorDiscordId?: string;
  entityKind?: EntityKind;
  entityExternalId?: string;
  summary: string;
  before?: object;
  after?: object;
  metadata?: object;
};

export async function audit(db: Pick<PrismaClient, 'auditEvent'>, input: AuditInput): Promise<void> {
  await db.auditEvent.create({ data: input });
}
