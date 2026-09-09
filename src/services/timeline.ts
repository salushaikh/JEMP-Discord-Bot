import { EntityKind, TimelineEventType, TimelineVisibility, type Prisma, type PrismaClient } from '@prisma/client';
import { randomToken, sha256 } from '../lib/crypto.js';
import { DomainError } from '../lib/errors.js';
import { jempId } from '../lib/ids.js';

type Db = PrismaClient | Prisma.TransactionClient;

export type TimelineInput = {
  memberId: string;
  type: TimelineEventType;
  title: string;
  summary?: string;
  source: string;
  idempotencyKey: string;
  occurredAt: Date;
  visibility?: TimelineVisibility;
  entity?: { kind: EntityKind; externalId: string; name?: string };
  metadata?: Prisma.InputJsonValue;
};

export async function recordTimelineEvent(db: Db, input: TimelineInput) {
  const existing = await db.timelineEvent.findUnique({
    where: { source_idempotencyKey: { source: input.source, idempotencyKey: input.idempotencyKey } }
  });
  if (existing) return { event: existing, wasCreated: false };

  const event = await db.timelineEvent.create({
    data: {
      memberId: input.memberId,
      type: input.type,
      title: input.title,
      summary: input.summary,
      source: input.source,
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.occurredAt,
      visibility: input.visibility ?? TimelineVisibility.MEMBER_ONLY,
      entityKind: input.entity?.kind,
      entityExternalId: input.entity?.externalId,
      entityName: input.entity?.name,
      metadata: input.metadata
    }
  });
  return { event, wasCreated: true };
}

export async function getTimeline(db: Pick<PrismaClient, 'member' | 'timelineEvent'>, memberId: string, publicOnly = false) {
  const member = await db.member.findUnique({ where: { id: memberId } });
  if (!member) throw new DomainError('Member not found.', 'MEMBER_NOT_FOUND');
  const events = await db.timelineEvent.findMany({
    where: { memberId, ...(publicOnly ? { visibility: TimelineVisibility.PUBLIC } : {}) },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }]
  });
  return { member, events };
}

export async function issueTimelineShare(
  db: Pick<PrismaClient, 'timelineShare'>,
  memberId: string,
  createdBy: string,
  ttlHours: number
) {
  const token = randomToken();
  const share = await db.timelineShare.create({
    data: { memberId, tokenHash: sha256(token), createdBy, expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000) }
  });
  return { token, expiresAt: share.expiresAt };
}

export async function resolvePublicTimelineShare(
  db: Pick<PrismaClient, 'timelineShare' | 'member' | 'timelineEvent'>,
  token: string
) {
  const share = await db.timelineShare.findUnique({ where: { tokenHash: sha256(token) } });
  if (!share || share.revokedAt || share.expiresAt <= new Date()) throw new DomainError('This Timeline share link is unavailable.', 'SHARE_UNAVAILABLE');
  const timeline = await getTimeline(db, share.memberId, true);
  return { ...timeline, expiresAt: share.expiresAt, memberJempId: jempId(timeline.member.jempNumber) };
}

export async function revokeTimelineShare(db: Pick<PrismaClient, 'timelineShare'>, token: string): Promise<void> {
  const result = await db.timelineShare.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  if (result.count === 0) throw new DomainError('This Timeline share link is already unavailable.', 'SHARE_UNAVAILABLE');
}
