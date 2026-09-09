-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WAITLISTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('APPLIED', 'APPROVED', 'ELIGIBLE', 'JOINED_UNVERIFIED', 'EMAIL_VERIFIED', 'ONBOARDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED', 'LEFT', 'REJOIN_PENDING');

-- CreateEnum
CREATE TYPE "TimelineVisibility" AS ENUM ('PRIVATE', 'MEMBER_ONLY', 'PUBLIC');

-- CreateEnum
CREATE TYPE "TimelineEventType" AS ENUM ('MEMBER_JOINED', 'JEMP_ASSIGNED', 'MEMBERSHIP_ACTIVATED', 'BRAINSTORM_JOINED', 'BRAINSTORM_CONTRIBUTION', 'BRAINSTORM_COMPLETED', 'PROJECT_JOINED', 'WORK_UPDATE', 'MILESTONE_COMPLETED', 'PROJECT_REPORT', 'INCIDENT_REPORT', 'PROJECT_COMPLETED', 'OPPORTUNITY_JOINED', 'CLIENT_PROJECT_PARTICIPATION', 'CLIENT_MILESTONE', 'CLIENT_REPORT', 'CLIENT_PROJECT_COMPLETED', 'PAYMENT_VERIFIED', 'PAYMENT_RECEIVED', 'PAYROLL_EVENT', 'PROFILE_UPDATED', 'MEMBERSHIP_STATUS_CHANGED');

-- CreateEnum
CREATE TYPE "EntityKind" AS ENUM ('MEMBER', 'BRAINSTORM', 'PROJECT', 'OPPORTUNITY', 'PAYMENT', 'PAYROLL', 'OTHER');

-- CreateEnum
CREATE TYPE "BrainstormStatus" AS ENUM ('BRAINSTORMING', 'COOKING', 'PAUSED', 'CANCELLED', 'ITS_ALIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BrainstormRole" AS ENUM ('OWNER', 'CORE_CONTRIBUTOR', 'CONTRIBUTOR', 'ADVISOR', 'OBSERVER');

-- CreateEnum
CREATE TYPE "ParticipationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED', 'LEFT');

-- CreateEnum
CREATE TYPE "ParticipationApplicationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'OPEN', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'LEAD', 'CONTRIBUTOR', 'REVIEWER', 'OBSERVER');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('DRAFT', 'OPEN', 'REVIEWING', 'ACTIVE', 'CLOSED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OpportunityKind" AS ENUM ('CLIENT_PROJECT', 'FREELANCE', 'CONTRACT', 'HIRING', 'CONSULTING', 'MAINTENANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('DRAFT', 'INVOICED', 'RECEIVED', 'DISTRIBUTION_PROPOSED', 'DISPUTED', 'APPROVED', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "DistributionVote" AS ENUM ('PENDING', 'APPROVED', 'NOT_SATISFIED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATED', 'UPDATED', 'DELETED', 'STATUS_CHANGED', 'ACCESS_CHANGED', 'ROLE_CHANGED', 'APPLICATION_ADDED', 'APPLICATION_REVOKED', 'VERIFIED', 'TIMELINE_RECORDED', 'EXPORT_CREATED', 'SHARE_CREATED', 'SHARE_REVOKED', 'PAYMENT_RECORDED', 'DISTRIBUTION_PROPOSED', 'DISTRIBUTION_VOTED', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED', 'COMMAND_DENIED', 'SECURITY_EVENT');

-- CreateTable
CREATE TABLE "GuildConfig" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "verificationCardMessageId" TEXT,
    "verifyChannelId" TEXT,
    "profileChannelId" TEXT,
    "applicationsChannelId" TEXT,
    "onboardingLogChannelId" TEXT,
    "adminLogChannelId" TEXT,
    "botLogChannelId" TEXT,
    "brainstormHubChannelId" TEXT,
    "projectHubChannelId" TEXT,
    "opportunitiesChannelId" TEXT,
    "payrollChannelId" TEXT,
    "unverifiedRoleId" TEXT,
    "memberRoleId" TEXT,
    "suspendedRoleId" TEXT,
    "terminatedRoleId" TEXT,
    "adminRoleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemCounter" (
    "key" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemCounter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "applicationNumber" INTEGER NOT NULL,
    "normalizedEmailHash" TEXT NOT NULL,
    "encryptedEmail" TEXT NOT NULL,
    "applicantName" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "approvedByDiscordId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "jempNumber" INTEGER NOT NULL,
    "discordUserId" TEXT,
    "discordUsername" TEXT,
    "displayName" TEXT,
    "status" "MembershipStatus" NOT NULL DEFAULT 'APPLIED',
    "applicationId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberProfile" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "encryptedBio" TEXT,
    "encryptedSkills" TEXT,
    "encryptedResume" TEXT,
    "publicProfile" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationAttempt" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "wasSuccessful" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipTransition" (
    "id" TEXT NOT NULL,
    "memberId" TEXT,
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "fromStatus" "MembershipStatus",
    "toStatus" "MembershipStatus" NOT NULL,
    "reason" TEXT,
    "actorDiscordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "type" "TimelineEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "entityKind" "EntityKind",
    "entityExternalId" TEXT,
    "entityName" TEXT,
    "source" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "visibility" "TimelineVisibility" NOT NULL DEFAULT 'MEMBER_ONLY',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineShare" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelineShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brainstorm" (
    "id" TEXT NOT NULL,
    "brainstormNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "problem" TEXT,
    "direction" TEXT,
    "audience" TEXT,
    "desiredSkills" TEXT[],
    "tags" TEXT[],
    "commitment" TEXT,
    "status" "BrainstormStatus" NOT NULL DEFAULT 'BRAINSTORMING',
    "ownerId" TEXT NOT NULL,
    "hubMessageId" TEXT,
    "threadId" TEXT,
    "statusReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brainstorm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainstormMember" (
    "brainstormId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "role" "BrainstormRole" NOT NULL DEFAULT 'CONTRIBUTOR',
    "status" "ParticipationStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "BrainstormMember_pkey" PRIMARY KEY ("brainstormId","memberId")
);

-- CreateTable
CREATE TABLE "BrainstormApplication" (
    "id" TEXT NOT NULL,
    "brainstormId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "contribution" TEXT NOT NULL,
    "experience" TEXT,
    "availability" TEXT,
    "portfolioUrl" TEXT,
    "status" "ParticipationApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "decisionReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrainstormApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainstormDecision" (
    "id" TEXT NOT NULL,
    "brainstormId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrainstormDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainstormTask" (
    "id" TEXT NOT NULL,
    "brainstormId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" INTEGER NOT NULL DEFAULT 2,
    "dueAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrainstormTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainstormMilestone" (
    "id" TEXT NOT NULL,
    "brainstormId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrainstormMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainstormResource" (
    "id" TEXT NOT NULL,
    "brainstormId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrainstormResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "projectNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerId" TEXT NOT NULL,
    "sourceBrainstormId" TEXT,
    "threadId" TEXT,
    "hubMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "projectId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'CONTRIBUTOR',
    "status" "ParticipationStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("projectId","memberId")
);

-- CreateTable
CREATE TABLE "WorkUpdate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isImportant" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMilestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "opportunityNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "OpportunityKind" NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerId" TEXT NOT NULL,
    "confidential" BOOLEAN NOT NULL DEFAULT true,
    "channelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityMember" (
    "opportunityId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "role" TEXT,
    "status" "ParticipationStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityMember_pkey" PRIMARY KEY ("opportunityId","memberId")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "paymentNumber" INTEGER NOT NULL,
    "projectId" TEXT,
    "opportunityId" TEXT,
    "currency" TEXT NOT NULL,
    "grossMinor" INTEGER NOT NULL,
    "adminFeeBps" INTEGER NOT NULL DEFAULT 500,
    "adminFeeMinor" INTEGER NOT NULL,
    "workPoolMinor" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'DRAFT',
    "receivedAt" TIMESTAMP(3),
    "rationale" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentShare" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "basisPoints" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "rationale" TEXT NOT NULL,

    CONSTRAINT "PaymentShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentVote" (
    "id" TEXT NOT NULL,
    "paymentShareId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "vote" "DistributionVote" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "votedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "resolution" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "actorMemberId" TEXT,
    "actorDiscordId" TEXT,
    "entityKind" "EntityKind",
    "entityExternalId" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuildConfig_guildId_key" ON "GuildConfig"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_applicationNumber_key" ON "Application"("applicationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Application_normalizedEmailHash_key" ON "Application"("normalizedEmailHash");

-- CreateIndex
CREATE UNIQUE INDEX "Member_jempNumber_key" ON "Member"("jempNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Member_discordUserId_key" ON "Member"("discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Member_applicationId_key" ON "Member"("applicationId");

-- CreateIndex
CREATE INDEX "Member_status_idx" ON "Member"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MemberProfile_memberId_key" ON "MemberProfile"("memberId");

-- CreateIndex
CREATE INDEX "VerificationAttempt_guildId_discordUserId_createdAt_idx" ON "VerificationAttempt"("guildId", "discordUserId", "createdAt");

-- CreateIndex
CREATE INDEX "MembershipTransition_guildId_discordUserId_createdAt_idx" ON "MembershipTransition"("guildId", "discordUserId", "createdAt");

-- CreateIndex
CREATE INDEX "MembershipTransition_memberId_createdAt_idx" ON "MembershipTransition"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "TimelineEvent_memberId_occurredAt_idx" ON "TimelineEvent"("memberId", "occurredAt");

-- CreateIndex
CREATE INDEX "TimelineEvent_entityKind_entityExternalId_idx" ON "TimelineEvent"("entityKind", "entityExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "TimelineEvent_source_idempotencyKey_key" ON "TimelineEvent"("source", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "TimelineShare_tokenHash_key" ON "TimelineShare"("tokenHash");

-- CreateIndex
CREATE INDEX "TimelineShare_memberId_expiresAt_idx" ON "TimelineShare"("memberId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Brainstorm_brainstormNumber_key" ON "Brainstorm"("brainstormNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Brainstorm_projectId_key" ON "Brainstorm"("projectId");

-- CreateIndex
CREATE INDEX "Brainstorm_status_createdAt_idx" ON "Brainstorm"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BrainstormMember_memberId_status_idx" ON "BrainstormMember"("memberId", "status");

-- CreateIndex
CREATE INDEX "BrainstormApplication_status_createdAt_idx" ON "BrainstormApplication"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrainstormApplication_brainstormId_memberId_key" ON "BrainstormApplication"("brainstormId", "memberId");

-- CreateIndex
CREATE INDEX "BrainstormTask_brainstormId_status_idx" ON "BrainstormTask"("brainstormId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Project_projectNumber_key" ON "Project"("projectNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Project_sourceBrainstormId_key" ON "Project"("sourceBrainstormId");

-- CreateIndex
CREATE INDEX "Project_status_createdAt_idx" ON "Project"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WorkUpdate_projectId_createdAt_idx" ON "WorkUpdate"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_opportunityNumber_key" ON "Opportunity"("opportunityNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentNumber_key" ON "Payment"("paymentNumber");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentShare_paymentId_memberId_key" ON "PaymentShare"("paymentId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentVote_paymentShareId_memberId_key" ON "PaymentVote"("paymentShareId", "memberId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityKind_entityExternalId_createdAt_idx" ON "AuditEvent"("entityKind", "entityExternalId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorDiscordId_createdAt_idx" ON "AuditEvent"("actorDiscordId", "createdAt");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberProfile" ADD CONSTRAINT "MemberProfile_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTransition" ADD CONSTRAINT "MembershipTransition_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brainstorm" ADD CONSTRAINT "Brainstorm_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainstormMember" ADD CONSTRAINT "BrainstormMember_brainstormId_fkey" FOREIGN KEY ("brainstormId") REFERENCES "Brainstorm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainstormMember" ADD CONSTRAINT "BrainstormMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainstormApplication" ADD CONSTRAINT "BrainstormApplication_brainstormId_fkey" FOREIGN KEY ("brainstormId") REFERENCES "Brainstorm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainstormApplication" ADD CONSTRAINT "BrainstormApplication_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainstormDecision" ADD CONSTRAINT "BrainstormDecision_brainstormId_fkey" FOREIGN KEY ("brainstormId") REFERENCES "Brainstorm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainstormTask" ADD CONSTRAINT "BrainstormTask_brainstormId_fkey" FOREIGN KEY ("brainstormId") REFERENCES "Brainstorm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainstormMilestone" ADD CONSTRAINT "BrainstormMilestone_brainstormId_fkey" FOREIGN KEY ("brainstormId") REFERENCES "Brainstorm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainstormResource" ADD CONSTRAINT "BrainstormResource_brainstormId_fkey" FOREIGN KEY ("brainstormId") REFERENCES "Brainstorm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkUpdate" ADD CONSTRAINT "WorkUpdate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityMember" ADD CONSTRAINT "OpportunityMember_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityMember" ADD CONSTRAINT "OpportunityMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentShare" ADD CONSTRAINT "PaymentShare_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentShare" ADD CONSTRAINT "PaymentShare_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVote" ADD CONSTRAINT "PaymentVote_paymentShareId_fkey" FOREIGN KEY ("paymentShareId") REFERENCES "PaymentShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVote" ADD CONSTRAINT "PaymentVote_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
