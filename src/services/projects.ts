import { AuditAction, EntityKind, ParticipationStatus, ProjectRole, ProjectStatus, TimelineEventType, TimelineVisibility, type PrismaClient } from '@prisma/client';
import { DomainError } from '../lib/errors.js';
import { projectId } from '../lib/ids.js';
import { sanitizeUserText } from '../lib/text.js';
import { audit } from './audit.js';
import { nextNumber } from './counters.js';
import { recordTimelineEvent } from './timeline.js';

export async function createProject(db: PrismaClient, input: { ownerId: string; title: string; description: string }) {
  const title = sanitizeUserText(input.title, 120);
  const description = sanitizeUserText(input.description, 4_000);
  if (!title || !description) throw new DomainError('Project title and description are required.', 'INVALID_INPUT');
  const project = await db.$transaction(async (tx) => {
    const projectNumber = await nextNumber(tx, 'project');
    return tx.project.create({ data: { projectNumber, title, description, status: ProjectStatus.OPEN, ownerId: input.ownerId, members: { create: { memberId: input.ownerId, role: ProjectRole.OWNER } } } });
  });
  await audit(db, { action: AuditAction.CREATED, actorMemberId: input.ownerId, entityKind: EntityKind.PROJECT, entityExternalId: projectId(project.projectNumber), summary: `Created ${projectId(project.projectNumber)} — ${project.title}.` });
  return project;
}

export async function assertProjectMember(db: PrismaClient, projectIdValue: string, actorId: string, requireLead = false, isAdmin = false) {
  const project = await db.project.findUnique({ where: { id: projectIdValue } });
  if (!project) throw new DomainError('Project not found.', 'PROJECT_NOT_FOUND');
  if (isAdmin || project.ownerId === actorId) return project;
  const membership = await db.projectMember.findUnique({ where: { projectId_memberId: { projectId: project.id, memberId: actorId } } });
  if (!membership || membership.status !== ParticipationStatus.ACTIVE || (requireLead && membership.role !== ProjectRole.LEAD)) throw new DomainError('You do not have access to manage this project.', 'PROJECT_ACCESS_REQUIRED');
  return project;
}

export async function addProjectMember(db: PrismaClient, input: { projectId: string; memberId: string; actorId: string; role?: ProjectRole; isAdmin?: boolean }) {
  const project = await assertProjectMember(db, input.projectId, input.actorId, true, input.isAdmin);
  const membership = await db.projectMember.upsert({
    where: { projectId_memberId: { projectId: project.id, memberId: input.memberId } },
    create: { projectId: project.id, memberId: input.memberId, role: input.role ?? ProjectRole.CONTRIBUTOR },
    update: { role: input.role ?? ProjectRole.CONTRIBUTOR, status: ParticipationStatus.ACTIVE, leftAt: null }
  });
  await recordTimelineEvent(db, { memberId: input.memberId, type: TimelineEventType.PROJECT_JOINED, title: `Joined ${projectId(project.projectNumber)} — ${project.title}`, source: 'project', idempotencyKey: `project-member:${project.id}:${input.memberId}`, occurredAt: new Date(), visibility: TimelineVisibility.MEMBER_ONLY, entity: { kind: EntityKind.PROJECT, externalId: projectId(project.projectNumber), name: project.title } });
  await audit(db, { action: AuditAction.ACCESS_CHANGED, actorMemberId: input.actorId, entityKind: EntityKind.PROJECT, entityExternalId: projectId(project.projectNumber), summary: 'A project contributor was added.' });
  return membership;
}

export async function logWorkUpdate(db: PrismaClient, input: { projectId: string; authorId: string; kind: 'UPDATE' | 'REPORT' | 'INCIDENT'; title: string; body: string }) {
  const project = await assertProjectMember(db, input.projectId, input.authorId);
  if (!([ProjectStatus.OPEN, ProjectStatus.ACTIVE, ProjectStatus.PAUSED] as ProjectStatus[]).includes(project.status)) throw new DomainError('Work updates cannot be recorded for this project state.', 'PROJECT_NOT_ACTIVE');
  const update = await db.workUpdate.create({ data: { projectId: project.id, authorId: input.authorId, kind: input.kind, title: sanitizeUserText(input.title, 180), body: sanitizeUserText(input.body, 4_000), isImportant: true } });
  const type = input.kind === 'INCIDENT' ? TimelineEventType.INCIDENT_REPORT : input.kind === 'REPORT' ? TimelineEventType.PROJECT_REPORT : TimelineEventType.WORK_UPDATE;
  await recordTimelineEvent(db, { memberId: input.authorId, type, title: `${projectId(project.projectNumber)} — ${update.title}`, summary: update.body, source: 'project', idempotencyKey: `work-update:${update.id}`, occurredAt: update.createdAt, visibility: TimelineVisibility.MEMBER_ONLY, entity: { kind: EntityKind.PROJECT, externalId: projectId(project.projectNumber), name: project.title }, metadata: { workUpdateId: update.id, kind: input.kind } });
  await audit(db, { action: AuditAction.CREATED, actorMemberId: input.authorId, entityKind: EntityKind.PROJECT, entityExternalId: projectId(project.projectNumber), summary: `${input.kind.toLowerCase()} recorded for ${projectId(project.projectNumber)}.` });
  return update;
}
