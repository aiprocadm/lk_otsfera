import type { PrismaClient, CommissionStatement } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';

export type ApproveInput = {
  statementId: string;
  partnerId: string;
  approvedByUserId: string;
};

export type MarkPaidInput = {
  statementId: string;
  paidByUserId: string;
  paidAt?: Date;
};

/**
 * Partner-admin approves a draft statement. Transition: draft → approved.
 * No higher status allowed (already approved/paid/superseded → LIFECYCLE_VIOLATION).
 * Ownership enforced by partnerId match — caller must pass the session's partnerId.
 */
export async function approveStatement(
  prisma: PrismaClient,
  input: ApproveInput
): Promise<CommissionStatement> {
  const statement = await prisma.commissionStatement.findFirst({
    where: { id: input.statementId, partnerId: input.partnerId },
    select: {
      id: true,
      status: true,
      supersededBy: true
    }
  });
  if (!statement) throw new Error('NOT_FOUND: commission statement not under given partner');
  if (statement.supersededBy) {
    throw new Error('LIFECYCLE_VIOLATION: cannot approve superseded statement');
  }
  if (statement.status !== 'draft') {
    throw new Error(`LIFECYCLE_VIOLATION: cannot approve from status=${statement.status}`);
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.commissionStatement.update({
      where: { id: statement.id },
      data: {
        status: 'approved',
        approvedByUserId: input.approvedByUserId,
        approvedAt: now
      }
    });
    await recordAudit(tx, {
      userId: input.approvedByUserId,
      action: 'commission_statement_approved',
      entity: 'commission_statement',
      entityId: statement.id,
      after: { partnerId: input.partnerId, approvedAt: now.toISOString() },
    });
    return result;
  });

  return updated;
}

/**
 * Platform admin marks an approved statement as paid. Transition: approved → paid.
 * RBAC: caller must be a User with role='admin'. Not partner-admin — this is the
 * platform side acknowledging actual money transfer.
 */
export async function markStatementPaid(
  prisma: PrismaClient,
  input: MarkPaidInput
): Promise<CommissionStatement> {
  const payer = await prisma.user.findUnique({
    where: { id: input.paidByUserId },
    select: { role: true }
  });
  if (!payer) throw new Error('FORBIDDEN: paying user not found');
  if (payer.role !== 'admin') {
    throw new Error('FORBIDDEN: only platform admin can mark commission as paid');
  }

  const statement = await prisma.commissionStatement.findUnique({
    where: { id: input.statementId },
    select: {
      id: true,
      status: true,
      supersededBy: true,
      partnerId: true
    }
  });
  if (!statement) throw new Error('NOT_FOUND: commission statement');
  if (statement.supersededBy) {
    throw new Error('LIFECYCLE_VIOLATION: cannot mark superseded statement as paid');
  }
  if (statement.status !== 'approved') {
    throw new Error(`LIFECYCLE_VIOLATION: cannot pay from status=${statement.status}`);
  }

  const paidAt = input.paidAt ?? new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.commissionStatement.update({
      where: { id: statement.id },
      data: {
        status: 'paid',
        paidAt
      }
    });
    await recordAudit(tx, {
      userId: input.paidByUserId,
      action: 'commission_statement_paid',
      entity: 'commission_statement',
      entityId: statement.id,
      after: {
        partnerId: statement.partnerId,
        paidAt: paidAt.toISOString(),
      },
    });
    return result;
  });

  return updated;
}
