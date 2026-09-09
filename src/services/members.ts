import {
  ApplicationStatus,
  AuditAction,
  EntityKind,
  MembershipStatus,
  TimelineEventType,
  TimelineVisibility,
  type Prisma,
  type PrismaClient
} from '@prisma/client';
import type { GuildMember } from 'discord.js';
import type { Env } from '../config/env.js';
import { emailHash, encrypt, normalizeEmail } from '../lib/crypto.js';
import { DomainError, GENERIC_VERIFICATION_FAILURE } from '../lib/errors.js';
import { applicationId, jempId } from '../lib/ids.js';
import { nextNumber } from './counters.js';
import { audit } from './audit.js';
import { recordTimelineEvent } from './timeline.js';

type Db = PrismaClient | Prisma.TransactionClient;

export async function activeMemberForDiscord(db: Pick<PrismaClient, 'member'>, discordUserId: string) {
  return db.member.findFirst({ where: { discordUserId, status: MembershipStatus.ACTIVE } });
}

export async function memberForDiscord(db: Pick<PrismaClient, 'member'>, discordUserId: string) {
  return db.member.findUnique({ where: { discordUserId } });
}

export async function requireActiveMember(db: Pick<PrismaClient, 'member'>, discordUserId: string) {
  const member = await activeMemberForDiscord(db, discordUserId);
  if (!member) throw new DomainError('Only active JEMP members can use this workflow.', 'ACTIVE_MEMBERSHIP_REQUIRED');
  return member;
}

export async function addApprovedApplication(
  db: PrismaClient,
  env: Env,
  input: { email: string; applicantName: string; notes?: string; expiresAt?: Date; actorDiscordId: string }
) {
  const normalizedEmail = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new DomainError('Enter a valid application email address.', 'INVALID_EMAIL');
  const hash = emailHash(normalizedEmail);
  const record = await db.$transaction(async (tx) => {
    const existing = await tx.application.findUnique({ where: { normalizedEmailHash: hash } });
    if (existing) {
      return tx.application.update({
        where: { id: existing.id },
        data: {
          applicantName: input.applicantName.trim().slice(0, 120),
          status: ApplicationStatus.APPROVED,
          notes: input.notes?.trim().slice(0, 2000),
          expiresAt: input.expiresAt,
          revokedAt: null,
          approvedByDiscordId: input.actorDiscordId
        }
      });
    }
    const applicationNumber = await nextNumber(tx, 'application');
    return tx.application.create({
      data: {
        applicationNumber,
        normalizedEmailHash: hash,
        encryptedEmail: encrypt(normalizedEmail, env.DATA_ENCRYPTION_KEY),
        applicantName: input.applicantName.trim().slice(0, 120),
        status: ApplicationStatus.APPROVED,
        notes: input.notes?.trim().slice(0, 2000),
        expiresAt: input.expiresAt,
        approvedByDiscordId: input.actorDiscordId
      }
    });
  });
  await audit(db, {
    action: AuditAction.APPLICATION_ADDED,
    actorDiscordId: input.actorDiscordId,
    entityKind: EntityKind.MEMBER,
    entityExternalId: applicationId(record.applicationNumber),
    summary: `Approved application ${applicationId(record.applicationNumber)} was added or refreshed.`,
    metadata: { applicationId: record.id }
  });
  return record;
}

export async function revokeApplication(db: PrismaClient, applicationNumber: number, actorDiscordId: string, reason?: string) {
  const application = await db.application.update({
    where: { applicationNumber },
    data: { status: ApplicationStatus.REVOKED, revokedAt: new Date() }
  });
  await audit(db, {
    action: AuditAction.APPLICATION_REVOKED,
    actorDiscordId,
    entityKind: EntityKind.MEMBER,
    entityExternalId: applicationId(application.applicationNumber),
    summary: `Application ${applicationId(application.applicationNumber)} was revoked.`,
    metadata: { reason: reason?.slice(0, 1000) }
  });
  return application;
}

export async function recordArrival(db: PrismaClient, guildId: string, discordUserId: string) {
  const known = await db.member.findUnique({ where: { discordUserId } });
  await db.membershipTransition.create({
    data: {
      memberId: known?.id,
      guildId,
      discordUserId,
      fromStatus: known?.status,
      toStatus: known?.status ?? MembershipStatus.JOINED_UNVERIFIED,
      reason: 'Discord guild arrival'
    }
  });
}

export async function verifyApprovedEmail(
  db: PrismaClient,
  env: Env,
  input: { guildId: string; discordUserId: string; discordUsername: string; displayName: string; email: string }
) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - env.VERIFICATION_WINDOW_MINUTES * 60 * 1000);
  const normalizedEmail = normalizeEmail(input.email);
  const hash = emailHash(normalizedEmail);
  const attempts = await db.verificationAttempt.count({
    where: { guildId: input.guildId, discordUserId: input.discordUserId, createdAt: { gte: cutoff } }
  });
  if (attempts >= env.MAX_EMAIL_VERIFICATION_ATTEMPTS) throw new DomainError('Too many verification attempts. Please wait before trying again or contact an administrator.', 'RATE_LIMITED');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    await db.verificationAttempt.create({ data: { guildId: input.guildId, discordUserId: input.discordUserId, emailHash: hash } });
    throw new DomainError(GENERIC_VERIFICATION_FAILURE, 'VERIFICATION_FAILED');
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const application = await tx.application.findUnique({ where: { normalizedEmailHash: hash }, include: { member: true } });
      const boundMember = await tx.member.findUnique({ where: { discordUserId: input.discordUserId } });
      const applicationEligible = application?.status === ApplicationStatus.APPROVED && (!application.expiresAt || application.expiresAt > now) && !application.revokedAt;
      const emailBoundElsewhere = Boolean(application?.member?.discordUserId && application.member.discordUserId !== input.discordUserId);
      const discordBoundElsewhere = Boolean(boundMember && boundMember.applicationId !== application?.id);
      if (!applicationEligible || emailBoundElsewhere || discordBoundElsewhere) throw new DomainError(GENERIC_VERIFICATION_FAILURE, 'VERIFICATION_FAILED');

      let member = application!.member;
      if (!member) {
        const jempNumber = await nextNumber(tx, 'member');
        member = await tx.member.create({
          data: {
            jempNumber,
            applicationId: application!.id,
            discordUserId: input.discordUserId,
            discordUsername: input.discordUsername,
            displayName: input.displayName,
            status: MembershipStatus.EMAIL_VERIFIED,
            joinedAt: now
          }
        });
      } else {
        member = await tx.member.update({
          where: { id: member.id },
          data: { discordUserId: input.discordUserId, discordUsername: input.discordUsername, displayName: input.displayName, status: MembershipStatus.EMAIL_VERIFIED }
        });
      }

      const active = await tx.member.update({
        where: { id: member.id },
        data: { status: MembershipStatus.ACTIVE, activatedAt: member.activatedAt ?? now }
      });
      await tx.membershipTransition.createMany({
        data: [
          { memberId: member.id, guildId: input.guildId, discordUserId: input.discordUserId, fromStatus: member.status, toStatus: MembershipStatus.EMAIL_VERIFIED, reason: 'Approved application email verified' },
          { memberId: member.id, guildId: input.guildId, discordUserId: input.discordUserId, fromStatus: MembershipStatus.EMAIL_VERIFIED, toStatus: MembershipStatus.ACTIVE, reason: 'Automatic membership activation' }
        ]
      });
      await recordTimelineEvent(tx, {
        memberId: active.id,
        type: TimelineEventType.MEMBERSHIP_ACTIVATED,
        title: 'Membership activated in Jobless Empire',
        source: 'onboarding',
        idempotencyKey: `membership-activated:${active.id}`,
        occurredAt: now,
        visibility: TimelineVisibility.MEMBER_ONLY,
        entity: { kind: EntityKind.MEMBER, externalId: jempId(active.jempNumber), name: 'Jobless Empire membership' }
      });
      return active;
    });
    await db.verificationAttempt.create({ data: { guildId: input.guildId, discordUserId: input.discordUserId, emailHash: hash, wasSuccessful: true } });
    await audit(db, {
      action: AuditAction.VERIFIED,
      actorMemberId: result.id,
      actorDiscordId: input.discordUserId,
      entityKind: EntityKind.MEMBER,
      entityExternalId: jempId(result.jempNumber),
      summary: 'Membership email verification completed.'
    });
    return result;
  } catch (error) {
    await db.verificationAttempt.create({ data: { guildId: input.guildId, discordUserId: input.discordUserId, emailHash: hash } });
    if (error instanceof DomainError) throw error;
    throw error;
  }
}

export async function applyMembershipRoles(member: GuildMember, config: { unverifiedRoleId?: string | null; memberRoleId?: string | null }) {
  if (config.unverifiedRoleId && member.roles.cache.has(config.unverifiedRoleId)) await member.roles.remove(config.unverifiedRoleId, 'JEMP email verification completed');
  if (config.memberRoleId && !member.roles.cache.has(config.memberRoleId)) await member.roles.add(config.memberRoleId, 'JEMP membership activated');
}
