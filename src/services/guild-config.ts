import type { GuildMember } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env.js';
import { DomainError } from '../lib/errors.js';

export type EffectiveGuildConfig = {
  guildId: string;
  verificationCardMessageId?: string | null;
  verifyChannelId?: string | null;
  profileChannelId?: string | null;
  applicationsChannelId?: string | null;
  onboardingLogChannelId?: string | null;
  adminLogChannelId?: string | null;
  botLogChannelId?: string | null;
  brainstormHubChannelId?: string | null;
  projectHubChannelId?: string | null;
  opportunitiesChannelId?: string | null;
  payrollChannelId?: string | null;
  unverifiedRoleId?: string | null;
  memberRoleId?: string | null;
  suspendedRoleId?: string | null;
  terminatedRoleId?: string | null;
  adminRoleId?: string | null;
};

function withEnvDefaults(guildId: string, env: Env): EffectiveGuildConfig {
  return {
    guildId,
    verifyChannelId: env.VERIFY_ME_CHANNEL_ID,
    profileChannelId: env.PROFILE_MANAGER_CHANNEL_ID,
    applicationsChannelId: env.APPLICATIONS_CHANNEL_ID,
    onboardingLogChannelId: env.ONBOARDING_LOG_CHANNEL_ID,
    adminLogChannelId: env.ADMIN_LOG_CHANNEL_ID,
    botLogChannelId: env.BOT_LOG_CHANNEL_ID,
    brainstormHubChannelId: env.BRAINSTORM_HUB_CHANNEL_ID,
    projectHubChannelId: env.PROJECT_HUB_CHANNEL_ID,
    opportunitiesChannelId: env.OPPORTUNITIES_CHANNEL_ID,
    payrollChannelId: env.PAYROLL_CHANNEL_ID,
    unverifiedRoleId: env.UNVERIFIED_ROLE_ID,
    memberRoleId: env.MEMBER_ROLE_ID,
    suspendedRoleId: env.SUSPENDED_ROLE_ID,
    terminatedRoleId: env.TERMINATED_ROLE_ID,
    adminRoleId: env.ADMIN_ROLE_ID
  };
}

export async function getGuildConfig(db: Pick<PrismaClient, 'guildConfig'>, env: Env, guildId: string): Promise<EffectiveGuildConfig> {
  const saved = await db.guildConfig.findUnique({ where: { guildId } });
  return { ...withEnvDefaults(guildId, env), ...saved };
}

/** Writes values supplied by the deployment environment once; explicit DB setup values remain preferred after this. */
export async function seedGuildConfig(db: Pick<PrismaClient, 'guildConfig'>, env: Env, guildId: string) {
  const defaults = withEnvDefaults(guildId, env);
  return db.guildConfig.upsert({
    where: { guildId },
    create: defaults,
    update: {}
  });
}

export function isAdmin(member: GuildMember, config: EffectiveGuildConfig): boolean {
  return member.permissions.has(PermissionFlagsBits.Administrator)
    || Boolean(config.adminRoleId && member.roles.cache.has(config.adminRoleId));
}

export function requireAdmin(member: GuildMember, config: EffectiveGuildConfig): void {
  if (!isAdmin(member, config)) throw new DomainError('This action is restricted to Jobless Empire administrators.', 'ADMIN_REQUIRED');
}

export function requireChannel(actualChannelId: string | null, expectedChannelId: string | null | undefined, action: string): void {
  if (!expectedChannelId) throw new DomainError(`${action} has not been configured for this server.`, 'CHANNEL_NOT_CONFIGURED');
  if (actualChannelId !== expectedChannelId) throw new DomainError(`${action} is available only in its designated JEMP channel.`, 'WRONG_CHANNEL');
}
