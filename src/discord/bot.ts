import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Interaction,
  type ModalSubmitInteraction
} from 'discord.js';
import { BrainstormStatus, OpportunityKind, ProjectRole, type PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { Env } from '../config/env.js';
import { DomainError } from '../lib/errors.js';
import { deploySlashCommands } from './deploy.js';
import { applicationId, brainstormId, jempId, opportunityId, paymentId, projectId } from '../lib/ids.js';
import { addApprovedApplication, applyMembershipRoles, memberForDiscord, recordArrival, requireActiveMember, revokeApplication, verifyApprovedEmail } from '../services/members.js';
import { getGuildConfig, isAdmin, requireAdmin, requireChannel, seedGuildConfig, type EffectiveGuildConfig } from '../services/guild-config.js';
import { createBrainstorm, applyToBrainstorm, changeBrainstormStatus, convertBrainstormToProject, reviewBrainstormApplication } from '../services/brainstorms.js';
import { addProjectMember, createProject, logWorkUpdate } from '../services/projects.js';
import { createOpportunity, joinOpportunity } from '../services/opportunities.js';
import { proposeDistribution, recordPayment } from '../services/payroll.js';
import { updateProfile } from '../services/profiles.js';
import { getTimeline, issueTimelineShare } from '../services/timeline.js';
import { createTimelinePdf } from '../services/timeline-pdf.js';

export type BotContext = { db: PrismaClient; env: Env; logger: Logger };

const empireColor = 0x941c1c;

function card() {
  return {
    embeds: [new EmbedBuilder()
      .setColor(empireColor)
      .setTitle('⚔️ WELCOME TO JOBLESS EMPIRE')
      .setDescription('**Jobless doesn’t mean useless.**\n**No job. Still building.**\n\nBefore entering the Empire, verify the email address used for your approved Jobless Empire application. Your email is handled privately and never displayed here.')
      .setFooter({ text: 'JEMP verification is automatic and secure.' })],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('verify:email').setLabel('Verify Email').setEmoji('🔐').setStyle(ButtonStyle.Danger)
    )]
  };
}

function modal(customId: string, title: string, inputs: Array<{ id: string; label: string; style?: TextInputStyle; required?: boolean; max?: number; placeholder?: string }>) {
  return new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(...inputs.map((input) => new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(input.id)
      .setLabel(input.label)
      .setStyle(input.style ?? TextInputStyle.Short)
      .setRequired(input.required ?? true)
      .setMaxLength(input.max ?? (input.style === TextInputStyle.Paragraph ? 4_000 : 200))
      .setPlaceholder(input.placeholder ?? '')
  )));
}

async function guildMember(interaction: Interaction): Promise<GuildMember> {
  if (!interaction.guild) throw new DomainError('This workflow is only available inside the Jobless Empire server.', 'GUILD_REQUIRED');
  return interaction.guild.members.fetch(interaction.user.id);
}

async function configFor(ctx: BotContext, interaction: Interaction): Promise<EffectiveGuildConfig> {
  if (!interaction.guildId) throw new DomainError('This workflow is only available inside the Jobless Empire server.', 'GUILD_REQUIRED');
  return getGuildConfig(ctx.db, ctx.env, interaction.guildId);
}

async function ephemeralError(interaction: Interaction, error: unknown, logger: Logger) {
  const message = error instanceof DomainError && error.expose ? error.message : 'JEMP could not complete that action safely. The incident has been recorded for staff.';
  if (!(error instanceof DomainError)) logger.error({ err: error, interactionId: interaction.id }, 'discord interaction failed');
  if (interaction.isRepliable()) {
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: `⚠️ ${message}`, ephemeral: true }).catch(() => undefined);
    else await interaction.reply({ content: `⚠️ ${message}`, ephemeral: true }).catch(() => undefined);
  }
}

export async function postVerificationCard(client: Client, ctx: BotContext, guildId: string) {
  const config = await getGuildConfig(ctx.db, ctx.env, guildId);
  if (!config.verifyChannelId) throw new DomainError('VERIFY_ME_CHANNEL_ID has not been configured.', 'CHANNEL_NOT_CONFIGURED');
  const channel = await client.channels.fetch(config.verifyChannelId);
  if (!channel?.isTextBased() || !('send' in channel)) throw new DomainError('The verification channel must be a text-based guild channel.', 'INVALID_VERIFY_CHANNEL');
  if (config.verificationCardMessageId && 'messages' in channel) {
    const prior = await channel.messages.fetch(config.verificationCardMessageId).catch(() => null);
    if (prior) {
      await prior.edit(card());
      return prior;
    }
  }
  const posted = await channel.send(card());
  await ctx.db.guildConfig.upsert({ where: { guildId }, create: { guildId, verificationCardMessageId: posted.id }, update: { verificationCardMessageId: posted.id } });
  return posted;
}

async function sendWelcomeLog(client: Client, config: EffectiveGuildConfig, member: GuildMember, id: string) {
  if (!config.onboardingLogChannelId) return;
  const channel = await client.channels.fetch(config.onboardingLogChannelId).catch(() => null);
  if (channel?.isTextBased() && 'send' in channel) await channel.send(`⚔️ Welcome <@${member.id}> — **${id}** is now active in Jobless Empire.`).catch(() => undefined);
}

async function openVerifyModal(interaction: Interaction) {
  if (!interaction.isButton()) return;
  await interaction.showModal(modal('verify:email', 'Verify Jobless Empire membership', [
    { id: 'email', label: 'Email used for your JEMP application', placeholder: 'you@example.com', max: 254 }
  ]));
}

async function openBrainstormApplicationModal(interaction: Interaction) {
  if (!interaction.isButton()) return;
  const id = interaction.customId.slice('brainstorm:apply:'.length);
  await interaction.showModal(modal(`brainstorm:apply:${id}`, 'Apply to contribute', [
    { id: 'reason', label: 'Why do you want to contribute?', style: TextInputStyle.Paragraph, max: 1_500 },
    { id: 'contribution', label: 'What can you contribute?', style: TextInputStyle.Paragraph, max: 1_500 },
    { id: 'experience', label: 'Relevant experience', style: TextInputStyle.Paragraph, required: false, max: 1_500 },
    { id: 'availability', label: 'Availability', required: false, max: 300 },
    { id: 'portfolio', label: 'Portfolio URL', required: false, max: 500 }
  ]));
}

async function postBrainstormListing(ctx: BotContext, interaction: ModalSubmitInteraction, brainstorm: { id: string; brainstormNumber: number; title: string; description: string; problem: string | null; direction: string | null; desiredSkills: string[]; tags: string[] }) {
  const channel = interaction.channel;
  if (!channel?.isTextBased() || !('send' in channel)) return;
  const listing = await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(empireColor)
      .setTitle(`💡 ${brainstormId(brainstorm.brainstormNumber)} — ${brainstorm.title}`)
      .setDescription(brainstorm.description)
      .addFields(
        ...(brainstorm.problem ? [{ name: 'Problem / Opportunity', value: brainstorm.problem.slice(0, 1_024) }] : []),
        ...(brainstorm.direction ? [{ name: 'Proposed Direction', value: brainstorm.direction.slice(0, 1_024) }] : []),
        { name: 'Looking For', value: brainstorm.desiredSkills.length ? brainstorm.desiredSkills.join(' · ') : 'Open to contributors' },
        { name: 'Status', value: '🟢 Brainstorming', inline: true },
        { name: 'Tags', value: brainstorm.tags.length ? brainstorm.tags.map((tag) => `#${tag}`).join(' ') : '—', inline: true }
      )
      .setFooter({ text: 'Structured idea workspace · meaningful work is recorded in the JEMP Timeline' })],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`brainstorm:apply:${brainstorm.id}`).setLabel('Apply to Contribute').setEmoji('🙋').setStyle(ButtonStyle.Danger)
    )]
  });
  await ctx.db.brainstorm.update({ where: { id: brainstorm.id }, data: { hubMessageId: listing.id } });
}

async function renderTimeline(ctx: BotContext, discordUserId: string) {
  const member = await requireActiveMember(ctx.db, discordUserId);
  const timeline = await getTimeline(ctx.db, member.id);
  const lines = timeline.events.slice(0, 10).map((event) => `• <t:${Math.floor(event.occurredAt.getTime() / 1000)}:D> — **${event.title}**`).join('\n') || '_No official proof-of-work entries yet._';
  return {
    member,
    timeline,
    embed: new EmbedBuilder().setColor(empireColor).setTitle(`📜 ${jempId(member.jempNumber)} — Proof of Work`).setDescription(lines).setFooter({ text: `${timeline.events.length} canonical record(s) • Timeline records are immutable` })
  };
}

async function findActiveTarget(ctx: BotContext, discordId: string) {
  const target = await requireActiveMember(ctx.db, discordId);
  return target;
}

function parseShares(value: string): Array<{ number: number; basisPoints: number }> {
  const entries = value.split(';').map((item) => item.trim()).filter(Boolean);
  if (!entries.length) throw new DomainError('Enter shares such as JEMP#0001:6000;JEMP#0002:4000.', 'INVALID_SHARES');
  return entries.map((entry) => {
    const match = /^JEMP#(\d+):(\d+)$/.exec(entry.toUpperCase());
    if (!match) throw new DomainError('Shares must use JEMP#0001:6000;JEMP#0002:4000 format.', 'INVALID_SHARES');
    return { number: Number(match[1]), basisPoints: Number(match[2]) };
  });
}

async function handleCommand(ctx: BotContext, client: Client, interaction: ChatInputCommandInteraction) {
  const config = await configFor(ctx, interaction);
  const member = await guildMember(interaction);
  const admin = isAdmin(member, config);
  const group = interaction.commandName;
  const sub = interaction.options.getSubcommand();

  if (group === 'jemp') {
    requireAdmin(member, config);
    if (sub === 'setup') {
      await interaction.deferReply({ ephemeral: true });
      await postVerificationCard(client, ctx, interaction.guildId!);
      await interaction.editReply('The persistent JEMP verification card is live and has been refreshed.');
      return;
    }
    await interaction.reply({ content: `JEMP is online. Database, command routing, audit trail, and internal Timeline API are active.\nVerification: ${config.verifyChannelId ? 'configured' : 'needs configuration'}\nAdmin role: ${config.adminRoleId ? 'configured' : 'Discord Administrator fallback only'}`, ephemeral: true });
    return;
  }

  if (group === 'onboard') {
    requireAdmin(member, config);
    requireChannel(interaction.channelId, config.applicationsChannelId, 'Application management');
    await interaction.deferReply({ ephemeral: true });
    if (sub === 'add') {
      const expiresInDays = interaction.options.getInteger('expires_in_days');
      const application = await addApprovedApplication(ctx.db, ctx.env, {
        email: interaction.options.getString('email', true), applicantName: interaction.options.getString('name', true), notes: interaction.options.getString('notes') ?? undefined,
        expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : undefined, actorDiscordId: interaction.user.id
      });
      await interaction.editReply(`✅ ${applicationId(application.applicationNumber)} is approved and eligible for private email verification.`);
      return;
    }
    if (sub === 'revoke') {
      const application = await revokeApplication(ctx.db, interaction.options.getInteger('app_number', true), interaction.user.id, interaction.options.getString('reason') ?? undefined);
      await interaction.editReply(`✅ ${applicationId(application.applicationNumber)} has been revoked.`);
      return;
    }
    const application = await ctx.db.application.findUnique({ where: { applicationNumber: interaction.options.getInteger('app_number', true) }, include: { member: true } });
    if (!application) throw new DomainError('No application exists with that APP#.', 'APPLICATION_NOT_FOUND');
    await interaction.editReply(`**${applicationId(application.applicationNumber)}**\nApplicant: ${application.applicantName}\nStatus: ${application.status}\nDiscord: ${application.member?.discordUserId ? 'linked' : 'not yet linked'}\nExpiry: ${application.expiresAt ? `<t:${Math.floor(application.expiresAt.getTime() / 1000)}:D>` : 'none'}`);
    return;
  }

  if (group === 'profile') {
    requireChannel(interaction.channelId, config.profileChannelId, 'Profile management');
    if (sub === 'update') {
      await requireActiveMember(ctx.db, interaction.user.id);
      await interaction.showModal(modal('profile:update', 'Update your private JEMP profile', [
        { id: 'bio', label: 'Professional bio', style: TextInputStyle.Paragraph, required: false, max: 2_000 },
        { id: 'skills', label: 'Skills', style: TextInputStyle.Paragraph, required: false, max: 1_000 },
        { id: 'resume', label: 'Private résumé / portfolio URL', required: false, max: 2_000 }
      ]));
      return;
    }
    const target = await requireActiveMember(ctx.db, interaction.user.id);
    await interaction.reply({ content: `🪪 **${jempId(target.jempNumber)}**\nStatus: ${target.status}\nJoined: ${target.joinedAt ? `<t:${Math.floor(target.joinedAt.getTime() / 1000)}:D>` : 'unknown'}\nYour detailed profile is private. Use /profile update here to update it.`, ephemeral: true });
    return;
  }

  if (group === 'timeline') {
    requireChannel(interaction.channelId, config.profileChannelId, 'Timeline access');
    await interaction.deferReply({ ephemeral: true });
    const rendered = await renderTimeline(ctx, interaction.user.id);
    if (sub === 'view') {
      await interaction.editReply({ embeds: [rendered.embed] });
      return;
    }
    if (sub === 'share') {
      if (!ctx.env.PUBLIC_BASE_URL) throw new DomainError('Public Timeline sharing has not been configured with PUBLIC_BASE_URL.', 'PUBLIC_SHARE_NOT_CONFIGURED');
      const share = await issueTimelineShare(ctx.db, rendered.member.id, interaction.user.id, ctx.env.PUBLIC_SHARE_TTL_HOURS);
      await interaction.editReply(`🔗 Your revocable public Timeline link is ${ctx.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/public/timeline/${share.token}\nIt expires <t:${Math.floor(share.expiresAt.getTime() / 1000)}:R> and only shows events explicitly marked public.`);
      return;
    }
    const pdf = await createTimelinePdf({ jempId: jempId(rendered.member.jempNumber), generatedAt: new Date(), events: rendered.timeline.events });
    const attachment = new AttachmentBuilder(pdf, { name: `${jempId(rendered.member.jempNumber)}-timeline.pdf` });
    await interaction.editReply({ content: 'Your view-only Timeline document is attached. It is generated from canonical records at this moment.', files: [attachment] });
    return;
  }

  if (group === 'brainstorm') {
    requireChannel(interaction.channelId, config.brainstormHubChannelId, 'Brainstorming Club');
    const active = await requireActiveMember(ctx.db, interaction.user.id);
    if (sub === 'create') {
      await interaction.showModal(modal('brainstorm:create', 'Create a Brainstorm', [
        { id: 'title', label: 'Title', max: 120 }, { id: 'description', label: 'Detailed description', style: TextInputStyle.Paragraph, max: 4_000 }, { id: 'problem', label: 'Problem or opportunity', style: TextInputStyle.Paragraph, max: 2_000 }, { id: 'direction', label: 'Proposed direction', style: TextInputStyle.Paragraph, max: 2_000 }, { id: 'skills', label: 'Desired skills (comma-separated)', required: false, max: 300 }
      ]));
      return;
    }
    if (sub === 'review') {
      await interaction.deferReply({ ephemeral: true });
      const reviewed = await reviewBrainstormApplication(ctx.db, { applicationId: interaction.options.getString('application_id', true), reviewerId: active.id, accept: interaction.options.getBoolean('accept', true), reason: interaction.options.getString('reason') ?? undefined });
      await interaction.editReply(`✅ Application ${reviewed.id} has been ${reviewed.status.toLowerCase()}.`);
      return;
    }
    const number = interaction.options.getInteger('number', true);
    const brainstorm = await ctx.db.brainstorm.findUnique({ where: { brainstormNumber: number } });
    if (!brainstorm) throw new DomainError('No brainstorm exists with that B#.', 'BRAINSTORM_NOT_FOUND');
    if (sub === 'apply') {
      await interaction.showModal(modal(`brainstorm:apply:${brainstorm.id}`, `Apply to ${brainstormId(number)}`, [
        { id: 'reason', label: 'Why do you want to contribute?', style: TextInputStyle.Paragraph, max: 1_500 }, { id: 'contribution', label: 'What can you contribute?', style: TextInputStyle.Paragraph, max: 1_500 }, { id: 'experience', label: 'Relevant experience', style: TextInputStyle.Paragraph, required: false, max: 1_500 }, { id: 'availability', label: 'Availability', required: false, max: 300 }, { id: 'portfolio', label: 'Portfolio URL', required: false, max: 500 }
      ]));
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    if (sub === 'status') {
      const updated = await changeBrainstormStatus(ctx.db, { brainstormId: brainstorm.id, actorId: active.id, status: interaction.options.getString('state', true) as BrainstormStatus, reason: interaction.options.getString('reason', true), isAdmin: admin });
      await interaction.editReply(`✅ ${brainstormId(updated.brainstormNumber)} is now **${updated.status}**. Reason recorded.`);
      return;
    }
    const project = await convertBrainstormToProject(ctx.db, { brainstormId: brainstorm.id, actorId: active.id, projectTitle: interaction.options.getString('title') ?? undefined, isAdmin: admin });
    await interaction.editReply(`⚔️ ${brainstormId(brainstorm.brainstormNumber)} is alive as **${projectId(project.projectNumber)} — ${project.title}**.`);
    return;
  }

  if (group === 'project') {
    requireChannel(interaction.channelId, config.projectHubChannelId, 'Project management');
    const active = await requireActiveMember(ctx.db, interaction.user.id);
    await interaction.deferReply({ ephemeral: true });
    if (sub === 'create') {
      const project = await createProject(ctx.db, { ownerId: active.id, title: interaction.options.getString('title', true), description: interaction.options.getString('description', true) });
      await interaction.editReply(`🛠️ Created **${projectId(project.projectNumber)} — ${project.title}**.`);
      return;
    }
    const project = await ctx.db.project.findUnique({ where: { projectNumber: interaction.options.getInteger('number', true) } });
    if (!project) throw new DomainError('No project exists with that P#.', 'PROJECT_NOT_FOUND');
    if (sub === 'add-member') {
      const target = await findActiveTarget(ctx, interaction.options.getUser('member', true).id);
      await addProjectMember(ctx.db, { projectId: project.id, memberId: target.id, actorId: active.id, role: (interaction.options.getString('role') ?? 'CONTRIBUTOR') as ProjectRole, isAdmin: admin });
      await interaction.editReply(`✅ ${jempId(target.jempNumber)} is now a contributor on ${projectId(project.projectNumber)}.`);
      return;
    }
    const update = await logWorkUpdate(ctx.db, { projectId: project.id, authorId: active.id, kind: interaction.options.getString('kind', true) as 'UPDATE' | 'REPORT' | 'INCIDENT', title: interaction.options.getString('title', true), body: interaction.options.getString('details', true) });
    await interaction.editReply(`📜 ${update.kind.toLowerCase()} recorded in ${projectId(project.projectNumber)} and added to your canonical Timeline.`);
    return;
  }

  if (group === 'opportunity') {
    requireAdmin(member, config);
    requireChannel(interaction.channelId, config.opportunitiesChannelId, 'Client and hiring management');
    const active = await requireActiveMember(ctx.db, interaction.user.id);
    await interaction.deferReply({ ephemeral: true });
    if (sub === 'create') {
      const opportunity = await createOpportunity(ctx.db, { ownerId: active.id, title: interaction.options.getString('title', true), description: interaction.options.getString('description', true), kind: interaction.options.getString('kind', true) as OpportunityKind });
      await interaction.editReply(`💼 Created confidential **${opportunityId(opportunity.opportunityNumber)} — ${opportunity.title}**.`);
      return;
    }
    const opportunity = await ctx.db.opportunity.findUnique({ where: { opportunityNumber: interaction.options.getInteger('number', true) } });
    if (!opportunity) throw new DomainError('No opportunity exists with that HC#.', 'OPPORTUNITY_NOT_FOUND');
    const target = await findActiveTarget(ctx, interaction.options.getUser('member', true).id);
    await joinOpportunity(ctx.db, { opportunityId: opportunity.id, memberId: target.id, actorId: active.id, role: interaction.options.getString('role') ?? undefined, isAdmin: admin });
    await interaction.editReply(`✅ ${jempId(target.jempNumber)} was added to ${opportunityId(opportunity.opportunityNumber)}.`);
    return;
  }

  if (group === 'payroll') {
    requireAdmin(member, config);
    requireChannel(interaction.channelId, config.payrollChannelId, 'Payroll management');
    const active = await requireActiveMember(ctx.db, interaction.user.id);
    await interaction.deferReply({ ephemeral: true });
    if (sub === 'record') {
      const payment = await recordPayment(ctx.db, { createdById: active.id, currency: interaction.options.getString('currency', true), grossMinor: interaction.options.getInteger('gross_minor', true), adminFeeBps: interaction.options.getInteger('admin_fee_bps') ?? 500, receivedAt: new Date() });
      await interaction.editReply(`💰 Recorded **${paymentId(payment.paymentNumber)}**. Gross: ${payment.grossMinor} ${payment.currency} minor units; admin fee: ${payment.adminFeeMinor}; work pool: ${payment.workPoolMinor}.`);
      return;
    }
    const payment = await ctx.db.payment.findUnique({ where: { paymentNumber: interaction.options.getInteger('number', true) } });
    if (!payment) throw new DomainError('No payment exists with that PAY#.', 'PAYMENT_NOT_FOUND');
    const parsed = parseShares(interaction.options.getString('shares', true));
    const memberNumbers = parsed.map((share) => share.number);
    const recipients = await ctx.db.member.findMany({ where: { jempNumber: { in: memberNumbers }, status: 'ACTIVE' } });
    if (recipients.length !== parsed.length) throw new DomainError('Every share recipient must be an active, valid JEMP#.', 'INVALID_RECIPIENT');
    const byNumber = new Map(recipients.map((recipient) => [recipient.jempNumber, recipient]));
    const distribution = await proposeDistribution(ctx.db, { paymentId: payment.id, actorId: active.id, isAdmin: admin, rationale: interaction.options.getString('rationale', true), shares: parsed.map((share) => ({ memberId: byNumber.get(share.number)!.id, basisPoints: share.basisPoints, rationale: interaction.options.getString('rationale', true) })) });
    await interaction.editReply(`✅ Distribution proposed for ${paymentId(payment.paymentNumber)}. ${distribution.shares.length} contributor(s); rounding difference: ${distribution.roundingDifference} minor units. Fairness is subject to team review.`);
  }
}

async function handleModal(ctx: BotContext, client: Client, interaction: ModalSubmitInteraction) {
  const config = await configFor(ctx, interaction);
  const member = await guildMember(interaction);
  if (interaction.customId === 'verify:email') {
    await interaction.deferReply({ ephemeral: true });
    const verified = await verifyApprovedEmail(ctx.db, ctx.env, { guildId: interaction.guildId!, discordUserId: interaction.user.id, discordUsername: interaction.user.username, displayName: member.displayName, email: interaction.fields.getTextInputValue('email') });
    await applyMembershipRoles(member, config);
    await sendWelcomeLog(client, config, member, jempId(verified.jempNumber));
    await interaction.editReply(`⚔️ Welcome to Jobless Empire. Your identity is **${jempId(verified.jempNumber)}**. Your member access is now active.`);
    return;
  }
  if (interaction.customId === 'profile:update') {
    requireChannel(interaction.channelId, config.profileChannelId, 'Profile management');
    const active = await requireActiveMember(ctx.db, interaction.user.id);
    await updateProfile(ctx.db, ctx.env, { memberId: active.id, bio: interaction.fields.getTextInputValue('bio') || undefined, skills: interaction.fields.getTextInputValue('skills') || undefined, resumeUrl: interaction.fields.getTextInputValue('resume') || undefined });
    await interaction.reply({ content: '✅ Your private JEMP profile has been updated.', ephemeral: true });
    return;
  }
  if (interaction.customId === 'brainstorm:create') {
    requireChannel(interaction.channelId, config.brainstormHubChannelId, 'Brainstorming Club');
    const active = await requireActiveMember(ctx.db, interaction.user.id);
    const brainstorm = await createBrainstorm(ctx.db, {
      ownerId: active.id,
      title: interaction.fields.getTextInputValue('title'),
      description: interaction.fields.getTextInputValue('description'),
      problem: interaction.fields.getTextInputValue('problem'),
      direction: interaction.fields.getTextInputValue('direction'),
      desiredSkills: interaction.fields.getTextInputValue('skills').split(',').map((item) => item.trim()).filter(Boolean)
    });
    await postBrainstormListing(ctx, interaction, brainstorm);
    await interaction.reply({ content: `💡 Created **${brainstormId(brainstorm.brainstormNumber)} — ${brainstorm.title}**. It is now open for structured contributor applications.`, ephemeral: true });
    return;
  }
  if (interaction.customId.startsWith('brainstorm:apply:')) {
    requireChannel(interaction.channelId, config.brainstormHubChannelId, 'Brainstorming Club');
    const active = await requireActiveMember(ctx.db, interaction.user.id);
    const id = interaction.customId.slice('brainstorm:apply:'.length);
    const applied = await applyToBrainstorm(ctx.db, { brainstormId: id, memberId: active.id, reason: interaction.fields.getTextInputValue('reason'), contribution: interaction.fields.getTextInputValue('contribution'), experience: interaction.fields.getTextInputValue('experience') || undefined, availability: interaction.fields.getTextInputValue('availability') || undefined, portfolioUrl: interaction.fields.getTextInputValue('portfolio') || undefined });
    await interaction.reply({ content: `✅ Your application ${applied.id} has been sent to the brainstorm owner privately.`, ephemeral: true });
  }
}

export function createBot(ctx: BotContext) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  client.once(Events.ClientReady, async (ready) => {
    ctx.logger.info({ user: ready.user.tag }, 'JEMP bot ready');
    try {
      if (ctx.env.DISCORD_GUILD_ID) {
        await deploySlashCommands(ctx.env, ctx.logger, ctx.env.DISCORD_GUILD_ID);
      } else {
        for (const guild of ready.guilds.cache.values()) {
          await deploySlashCommands(ctx.env, ctx.logger, guild.id);
        }
      }
    } catch (deployError) {
      ctx.logger.warn({ err: deployError }, 'Automatic slash command deployment failed on bot ready');
    }
    for (const guild of ready.guilds.cache.values()) {
      await seedGuildConfig(ctx.db, ctx.env, guild.id);
      postVerificationCard(client, ctx, guild.id).catch((error) => ctx.logger.warn({ err: error, guildId: guild.id }, 'could not post verification card'));
    }
  });
  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      const config = await getGuildConfig(ctx.db, ctx.env, member.guild.id);
      await recordArrival(ctx.db, member.guild.id, member.id);
      if (config.unverifiedRoleId && !member.roles.cache.has(config.unverifiedRoleId)) await member.roles.add(config.unverifiedRoleId, 'JEMP arrival pending approved-email verification');
      await postVerificationCard(client, ctx, member.guild.id);
      await member.send('⚔️ Welcome to Jobless Empire. Complete verification from the **#verify-me** card using the email from your approved application.').catch(() => undefined);
    } catch (error) {
      ctx.logger.error({ err: error, discordUserId: member.id }, 'member arrival processing failed');
    }
  });
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId === 'verify:email') await openVerifyModal(interaction);
      else if (interaction.isButton() && interaction.customId.startsWith('brainstorm:apply:')) await openBrainstormApplicationModal(interaction);
      else if (interaction.isChatInputCommand()) await handleCommand(ctx, client, interaction);
      else if (interaction.isModalSubmit()) await handleModal(ctx, client, interaction);
    } catch (error) {
      await ephemeralError(interaction, error, ctx.logger);
    }
  });
  return client;
}
