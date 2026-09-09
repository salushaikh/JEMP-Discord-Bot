import {
  AuditAction,
  BrainstormRole,
  BrainstormStatus,
  EntityKind,
  ParticipationApplicationStatus,
  ParticipationStatus,
  TimelineEventType,
  TimelineVisibility,
  type Prisma,
  type PrismaClient
} from '@prisma/client';
import { DomainError } from '../lib/errors.js';
import { brainstormId, projectId } from '../lib/ids.js';
import { sanitizeUserText, safeUrl } from '../lib/text.js';
import { audit } from './audit.js';
import { nextNumber } from './counters.js';
import { recordTimelineEvent } from './timeline.js';

type Db = PrismaClient | Prisma.TransactionClient;

export type CreateBrainstormInput = {
  ownerId: string;
  title: string;
  description: string;
  problem?: string;
  direction?: string;
  audience?: string;
  desiredSkills?: string[];
  tags?: string[];
  commitment?: string;
};

function text(value: string, max: number) {
  const result = sanitizeUserText(value, max);
  if (!result) throw new DomainError('This field cannot be empty.', 'INVALID_INPUT');
  return result;
}

export async function createBrainstorm(db: PrismaClient, input: CreateBrainstormInput) {
  const title = text(input.title, 120);
  const description = text(input.description, 4_000);
  const brainstorm = await db.$transaction(async (tx) => {
    const brainstormNumber = await nextNumber(tx, 'brainstorm');
    const entity = await tx.brainstorm.create({
      data: {
        brainstormNumber,
        title,
        description,
        problem: input.problem ? text(input.problem, 2_000) : undefined,
        direction: input.direction ? text(input.direction, 2_000) : undefined,
        audience: input.audience ? text(input.audience, 500) : undefined,
        desiredSkills: (input.desiredSkills ?? []).map((item) => sanitizeUserText(item, 40)).filter(Boolean).slice(0, 12),
        tags: (input.tags ?? []).map((item) => sanitizeUserText(item.replace(/^#/, ''), 24)).filter(Boolean).slice(0, 8),
        commitment: input.commitment ? sanitizeUserText(input.commitment, 120) : undefined,
        ownerId: input.ownerId,
        members: { create: { memberId: input.ownerId, role: BrainstormRole.OWNER } }
      }
    });
    await recordTimelineEvent(tx, {
      memberId: input.ownerId,
      type: TimelineEventType.BRAINSTORM_JOINED,
      title: `Created ${brainstormId(entity.brainstormNumber)} — ${entity.title}`,
      source: 'brainstorm',
      idempotencyKey: `brainstorm-created:${entity.id}`,
      occurredAt: entity.createdAt,
      visibility: TimelineVisibility.MEMBER_ONLY,
      entity: { kind: EntityKind.BRAINSTORM, externalId: brainstormId(entity.brainstormNumber), name: entity.title }
    });
    return entity;
  });
  await audit(db, {
    action: AuditAction.CREATED,
    actorMemberId: input.ownerId,
    entityKind: EntityKind.BRAINSTORM,
    entityExternalId: brainstormId(brainstorm.brainstormNumber),
    summary: `Created ${brainstormId(brainstorm.brainstormNumber)} — ${brainstorm.title}.`
  });
  return brainstorm;
}

export async function assertBrainstormManager(db: Pick<PrismaClient, 'brainstorm' | 'brainstormMember'>, brainstormIdValue: string, actorId: string, admin = false) {
  const brainstorm = await db.brainstorm.findUnique({ where: { id: brainstormIdValue } });
  if (!brainstorm) throw new DomainError('Brainstorm not found.', 'BRAINSTORM_NOT_FOUND');
  if (admin || brainstorm.ownerId === actorId) return brainstorm;
  const membership = await db.brainstormMember.findUnique({ where: { brainstormId_memberId: { brainstormId: brainstorm.id, memberId: actorId } } });
  if (membership?.role !== BrainstormRole.CORE_CONTRIBUTOR) throw new DomainError('Only the owner or authorized JEMP staff can manage this brainstorm.', 'BRAINSTORM_MANAGER_REQUIRED');
  return brainstorm;
}

export async function applyToBrainstorm(
  db: PrismaClient,
  input: { brainstormId: string; memberId: string; reason: string; contribution: string; experience?: string; availability?: string; portfolioUrl?: string }
) {
  const brainstorm = await db.brainstorm.findUnique({ where: { id: input.brainstormId } });
  if (!brainstorm || !([BrainstormStatus.BRAINSTORMING, BrainstormStatus.COOKING] as BrainstormStatus[]).includes(brainstorm.status)) throw new DomainError('This brainstorm is not accepting contributors right now.', 'BRAINSTORM_NOT_OPEN');
  const existingMembership = await db.brainstormMember.findUnique({ where: { brainstormId_memberId: { brainstormId: input.brainstormId, memberId: input.memberId } } });
  if (existingMembership?.status === ParticipationStatus.ACTIVE) throw new DomainError('You are already a contributor to this brainstorm.', 'ALREADY_CONTRIBUTOR');
  if (input.portfolioUrl && !safeUrl(input.portfolioUrl)) throw new DomainError('Portfolio URL must be an http(s) URL.', 'INVALID_URL');
  const application = await db.brainstormApplication.upsert({
    where: { brainstormId_memberId: { brainstormId: input.brainstormId, memberId: input.memberId } },
    create: {
      brainstormId: input.brainstormId,
      memberId: input.memberId,
      reason: text(input.reason, 1_500),
      contribution: text(input.contribution, 1_500),
      experience: input.experience ? sanitizeUserText(input.experience, 1_500) : undefined,
      availability: input.availability ? sanitizeUserText(input.availability, 300) : undefined,
      portfolioUrl: input.portfolioUrl
    },
    update: {
      reason: text(input.reason, 1_500),
      contribution: text(input.contribution, 1_500),
      experience: input.experience ? sanitizeUserText(input.experience, 1_500) : undefined,
      availability: input.availability ? sanitizeUserText(input.availability, 300) : undefined,
      portfolioUrl: input.portfolioUrl,
      status: ParticipationApplicationStatus.PENDING,
      decisionReason: null,
      reviewedAt: null,
      reviewedById: null
    }
  });
  await audit(db, { action: AuditAction.CREATED, actorMemberId: input.memberId, entityKind: EntityKind.BRAINSTORM, entityExternalId: brainstormId(brainstorm.brainstormNumber), summary: 'Submitted a brainstorm contributor application.' });
  return application;
}

export async function reviewBrainstormApplication(
  db: PrismaClient,
  input: { applicationId: string; reviewerId: string; accept: boolean; reason?: string }
) {
  const result = await db.$transaction(async (tx) => {
    const application = await tx.brainstormApplication.findUnique({ where: { id: input.applicationId }, include: { brainstorm: true } });
    if (!application || application.status !== ParticipationApplicationStatus.PENDING) throw new DomainError('That application is no longer awaiting review.', 'APPLICATION_NOT_PENDING');
    if (application.brainstorm.ownerId !== input.reviewerId) throw new DomainError('Only the brainstorm owner can review this application.', 'BRAINSTORM_MANAGER_REQUIRED');
    const reviewed = await tx.brainstormApplication.update({
      where: { id: application.id },
      data: { status: input.accept ? ParticipationApplicationStatus.ACCEPTED : ParticipationApplicationStatus.REJECTED, reviewedAt: new Date(), reviewedById: input.reviewerId, decisionReason: input.reason ? sanitizeUserText(input.reason, 1_000) : null }
    });
    if (input.accept) {
      await tx.brainstormMember.upsert({
        where: { brainstormId_memberId: { brainstormId: application.brainstormId, memberId: application.memberId } },
        create: { brainstormId: application.brainstormId, memberId: application.memberId, role: BrainstormRole.CONTRIBUTOR },
        update: { role: BrainstormRole.CONTRIBUTOR, status: ParticipationStatus.ACTIVE, leftAt: null, reason: null }
      });
      await recordTimelineEvent(tx, {
        memberId: application.memberId,
        type: TimelineEventType.BRAINSTORM_JOINED,
        title: `Joined ${brainstormId(application.brainstorm.brainstormNumber)} — ${application.brainstorm.title}`,
        source: 'brainstorm',
        idempotencyKey: `brainstorm-member:${application.brainstormId}:${application.memberId}`,
        occurredAt: new Date(),
        visibility: TimelineVisibility.MEMBER_ONLY,
        entity: { kind: EntityKind.BRAINSTORM, externalId: brainstormId(application.brainstorm.brainstormNumber), name: application.brainstorm.title }
      });
    }
    return { application, reviewed };
  });
  await audit(db, { action: AuditAction.UPDATED, actorMemberId: input.reviewerId, entityKind: EntityKind.BRAINSTORM, entityExternalId: brainstormId(result.application.brainstorm.brainstormNumber), summary: `Brainstorm application was ${input.accept ? 'accepted' : 'rejected'}.` });
  return result.reviewed;
}

export async function changeBrainstormStatus(
  db: PrismaClient,
  input: { brainstormId: string; actorId: string; status: BrainstormStatus; reason: string; isAdmin?: boolean }
) {
  const brainstorm = await assertBrainstormManager(db, input.brainstormId, input.actorId, input.isAdmin);
  const reason = text(input.reason, 1_500);
  const updated = await db.brainstorm.update({ where: { id: brainstorm.id }, data: { status: input.status, statusReason: reason, archivedAt: input.status === BrainstormStatus.ARCHIVED ? new Date() : null } });
  await audit(db, { action: AuditAction.STATUS_CHANGED, actorMemberId: input.actorId, entityKind: EntityKind.BRAINSTORM, entityExternalId: brainstormId(updated.brainstormNumber), summary: `${brainstormId(updated.brainstormNumber)} status changed from ${brainstorm.status} to ${updated.status}.`, before: { status: brainstorm.status }, after: { status: updated.status, reason } });
  return updated;
}

export async function convertBrainstormToProject(
  db: PrismaClient,
  input: { brainstormId: string; actorId: string; projectTitle?: string; projectDescription?: string; isAdmin?: boolean }
) {
  const brainstorm = await assertBrainstormManager(db, input.brainstormId, input.actorId, input.isAdmin);
  if (brainstorm.projectId) throw new DomainError('This brainstorm has already been converted to a project.', 'ALREADY_CONVERTED');
  const project = await db.$transaction(async (tx) => {
    const projectNumber = await nextNumber(tx, 'project');
    const created = await tx.project.create({
      data: {
        projectNumber,
        title: input.projectTitle ? text(input.projectTitle, 120) : brainstorm.title,
        description: input.projectDescription ? text(input.projectDescription, 4_000) : brainstorm.description,
        status: 'DRAFT',
        ownerId: brainstorm.ownerId,
        sourceBrainstormId: brainstorm.id,
        members: { create: { memberId: brainstorm.ownerId, role: 'OWNER' } }
      }
    });
    const contributors = await tx.brainstormMember.findMany({ where: { brainstormId: brainstorm.id, status: ParticipationStatus.ACTIVE, memberId: { not: brainstorm.ownerId } } });
    if (contributors.length) await tx.projectMember.createMany({ data: contributors.map((member) => ({ projectId: created.id, memberId: member.memberId, role: 'CONTRIBUTOR' })) });
    await tx.brainstorm.update({ where: { id: brainstorm.id }, data: { projectId: created.id, status: BrainstormStatus.ITS_ALIVE, statusReason: `Converted into ${projectId(created.projectNumber)}.` } });
    return created;
  });
  await audit(db, { action: AuditAction.UPDATED, actorMemberId: input.actorId, entityKind: EntityKind.BRAINSTORM, entityExternalId: brainstormId(brainstorm.brainstormNumber), summary: `${brainstormId(brainstorm.brainstormNumber)} converted to ${projectId(project.projectNumber)}.`, after: { project: projectId(project.projectNumber) } });
  return project;
}
