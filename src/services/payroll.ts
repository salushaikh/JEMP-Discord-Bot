import { AuditAction, DistributionVote, EntityKind, PaymentStatus, type PrismaClient } from '@prisma/client';
import { DomainError } from '../lib/errors.js';
import { paymentId } from '../lib/ids.js';
import { sanitizeUserText } from '../lib/text.js';
import { audit } from './audit.js';
import { nextNumber } from './counters.js';

export type ShareInput = { memberId: string; basisPoints: number; rationale: string };

export function calculatePayment(grossMinor: number, adminFeeBps: number) {
  if (!Number.isSafeInteger(grossMinor) || grossMinor <= 0) throw new DomainError('Gross amount must be a positive value in the currency’s smallest unit.', 'INVALID_AMOUNT');
  if (!Number.isInteger(adminFeeBps) || adminFeeBps < 0 || adminFeeBps > 10_000) throw new DomainError('Admin fee must be between 0 and 100%.', 'INVALID_FEE');
  const adminFeeMinor = Math.round((grossMinor * adminFeeBps) / 10_000);
  return { adminFeeMinor, workPoolMinor: grossMinor - adminFeeMinor };
}

export async function recordPayment(db: PrismaClient, input: { createdById: string; currency: string; grossMinor: number; projectId?: string; opportunityId?: string; adminFeeBps?: number; receivedAt?: Date }) {
  const currency = input.currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new DomainError('Use a three-letter ISO currency code.', 'INVALID_CURRENCY');
  const fee = calculatePayment(input.grossMinor, input.adminFeeBps ?? 500);
  const payment = await db.$transaction(async (tx) => {
    const paymentNumber = await nextNumber(tx, 'payment');
    return tx.payment.create({ data: { paymentNumber, createdById: input.createdById, currency, grossMinor: input.grossMinor, adminFeeBps: input.adminFeeBps ?? 500, ...fee, projectId: input.projectId, opportunityId: input.opportunityId, status: input.receivedAt ? PaymentStatus.RECEIVED : PaymentStatus.DRAFT, receivedAt: input.receivedAt } });
  });
  await audit(db, { action: AuditAction.PAYMENT_RECORDED, actorMemberId: input.createdById, entityKind: EntityKind.PAYMENT, entityExternalId: paymentId(payment.paymentNumber), summary: `${paymentId(payment.paymentNumber)} was recorded.` });
  return payment;
}

export async function proposeDistribution(db: PrismaClient, input: { paymentId: string; actorId: string; rationale: string; shares: ShareInput[]; isAdmin?: boolean }) {
  const payment = await db.payment.findUnique({ where: { id: input.paymentId } });
  if (!payment) throw new DomainError('Payment record not found.', 'PAYMENT_NOT_FOUND');
  if (payment.createdById !== input.actorId && !input.isAdmin) throw new DomainError('Only the payment owner or staff can propose a distribution.', 'PAYROLL_MANAGER_REQUIRED');
  if (!([PaymentStatus.RECEIVED, PaymentStatus.DRAFT, PaymentStatus.DISTRIBUTION_PROPOSED] as PaymentStatus[]).includes(payment.status)) throw new DomainError('This payment cannot be distributed in its current state.', 'INVALID_PAYMENT_STATE');
  if (!input.shares.length) throw new DomainError('Add at least one contributor share.', 'MISSING_SHARES');
  const memberIds = new Set(input.shares.map((share) => share.memberId));
  if (memberIds.size !== input.shares.length) throw new DomainError('A contributor can only appear once in a distribution.', 'DUPLICATE_RECIPIENT');
  const total = input.shares.reduce((sum, share) => sum + share.basisPoints, 0);
  if (total !== 10_000) throw new DomainError('Contributor shares must total exactly 100.00%.', 'INVALID_DISTRIBUTION_TOTAL');
  for (const share of input.shares) {
    if (!Number.isInteger(share.basisPoints) || share.basisPoints < 0 || share.basisPoints > 10_000 || !sanitizeUserText(share.rationale, 1_000)) throw new DomainError('Each share needs a valid percentage and rationale.', 'INVALID_SHARE');
  }
  const activeRecipients = await db.member.count({ where: { id: { in: [...memberIds] }, status: 'ACTIVE' } });
  if (activeRecipients !== memberIds.size) throw new DomainError('Every recipient must be an active JEMP member.', 'INACTIVE_RECIPIENT');
  const created = await db.$transaction(async (tx) => {
    await tx.paymentShare.deleteMany({ where: { paymentId: payment.id } });
    const shares = await Promise.all(input.shares.map((share) => {
      const amountMinor = Math.floor((payment.workPoolMinor * share.basisPoints) / 10_000);
      return tx.paymentShare.create({ data: { paymentId: payment.id, memberId: share.memberId, basisPoints: share.basisPoints, amountMinor, rationale: sanitizeUserText(share.rationale, 1_000), votes: { create: { memberId: share.memberId, vote: DistributionVote.PENDING } } } });
    }));
    const allocated = shares.reduce((sum, share) => sum + share.amountMinor, 0);
    const roundingDifference = payment.workPoolMinor - allocated;
    if (roundingDifference !== 0) await tx.paymentShare.update({ where: { id: shares[0]!.id }, data: { amountMinor: { increment: roundingDifference } } });
    await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.DISTRIBUTION_PROPOSED, rationale: sanitizeUserText(input.rationale, 4_000) } });
    return { roundingDifference, shares };
  });
  await audit(db, { action: AuditAction.DISTRIBUTION_PROPOSED, actorMemberId: input.actorId, entityKind: EntityKind.PAYMENT, entityExternalId: paymentId(payment.paymentNumber), summary: `Distribution proposed for ${paymentId(payment.paymentNumber)}.`, metadata: { roundingDifference: created.roundingDifference } });
  return created;
}

export async function voteDistribution(db: PrismaClient, input: { paymentShareId: string; memberId: string; vote: DistributionVote; note?: string }) {
  if (input.vote === DistributionVote.PENDING) throw new DomainError('Choose approve or not satisfied.', 'INVALID_VOTE');
  const vote = await db.paymentVote.update({
    where: { paymentShareId_memberId: { paymentShareId: input.paymentShareId, memberId: input.memberId } },
    data: { vote: input.vote, note: input.note ? sanitizeUserText(input.note, 1_000) : undefined, votedAt: new Date() },
    include: { paymentShare: { include: { payment: true } } }
  });
  if (input.vote === DistributionVote.NOT_SATISFIED) await db.payment.update({ where: { id: vote.paymentShare.paymentId }, data: { status: PaymentStatus.DISPUTED } });
  await audit(db, { action: AuditAction.DISTRIBUTION_VOTED, actorMemberId: input.memberId, entityKind: EntityKind.PAYMENT, entityExternalId: paymentId(vote.paymentShare.payment.paymentNumber), summary: `Contributor recorded a ${input.vote} distribution vote.` });
  return vote;
}
