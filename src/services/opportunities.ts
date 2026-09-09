import { AuditAction, EntityKind, OpportunityKind, OpportunityStatus, ParticipationStatus, TimelineEventType, TimelineVisibility, type PrismaClient } from '@prisma/client';
import { DomainError } from '../lib/errors.js';
import { opportunityId } from '../lib/ids.js';
import { sanitizeUserText } from '../lib/text.js';
import { audit } from './audit.js';
import { nextNumber } from './counters.js';
import { recordTimelineEvent } from './timeline.js';

export async function createOpportunity(db: PrismaClient, input: { ownerId: string; title: string; description: string; kind: OpportunityKind; confidential?: boolean }) {
  const title = sanitizeUserText(input.title, 120);
  const description = sanitizeUserText(input.description, 4_000);
  if (!title || !description) throw new DomainError('Opportunity title and description are required.', 'INVALID_INPUT');
  const opportunity = await db.$transaction(async (tx) => {
    const opportunityNumber = await nextNumber(tx, 'opportunity');
    return tx.opportunity.create({ data: { opportunityNumber, title, description, kind: input.kind, status: OpportunityStatus.OPEN, confidential: input.confidential ?? true, ownerId: input.ownerId } });
  });
  await audit(db, { action: AuditAction.CREATED, actorMemberId: input.ownerId, entityKind: EntityKind.OPPORTUNITY, entityExternalId: opportunityId(opportunity.opportunityNumber), summary: `Created ${opportunityId(opportunity.opportunityNumber)} — ${opportunity.title}.` });
  return opportunity;
}

export async function joinOpportunity(db: PrismaClient, input: { opportunityId: string; memberId: string; actorId: string; role?: string; isAdmin?: boolean }) {
  const opportunity = await db.opportunity.findUnique({ where: { id: input.opportunityId } });
  if (!opportunity) throw new DomainError('Opportunity not found.', 'OPPORTUNITY_NOT_FOUND');
  if (opportunity.ownerId !== input.actorId && !input.isAdmin) throw new DomainError('Only the opportunity owner or staff can add participants.', 'OPPORTUNITY_MANAGER_REQUIRED');
  if (!([OpportunityStatus.OPEN, OpportunityStatus.REVIEWING, OpportunityStatus.ACTIVE] as OpportunityStatus[]).includes(opportunity.status)) throw new DomainError('This opportunity is not accepting participants.', 'OPPORTUNITY_NOT_OPEN');
  const member = await db.opportunityMember.upsert({
    where: { opportunityId_memberId: { opportunityId: opportunity.id, memberId: input.memberId } },
    create: { opportunityId: opportunity.id, memberId: input.memberId, role: input.role ? sanitizeUserText(input.role, 80) : undefined },
    update: { role: input.role ? sanitizeUserText(input.role, 80) : undefined, status: ParticipationStatus.ACTIVE }
  });
  await recordTimelineEvent(db, { memberId: input.memberId, type: TimelineEventType.OPPORTUNITY_JOINED, title: `Joined ${opportunityId(opportunity.opportunityNumber)} — ${opportunity.title}`, source: 'opportunity', idempotencyKey: `opportunity-member:${opportunity.id}:${input.memberId}`, occurredAt: new Date(), visibility: TimelineVisibility.MEMBER_ONLY, entity: { kind: EntityKind.OPPORTUNITY, externalId: opportunityId(opportunity.opportunityNumber), name: opportunity.title } });
  await audit(db, { action: AuditAction.ACCESS_CHANGED, actorMemberId: input.actorId, entityKind: EntityKind.OPPORTUNITY, entityExternalId: opportunityId(opportunity.opportunityNumber), summary: 'Opportunity participant added.' });
  return member;
}
