import { Prisma } from '@prisma/client';
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
): Promise<
  | { ok: true; statement: CommissionStatement }
  | { ok: false; error: 'not_found' | 'lifecycle_violation' }
> {
  const statement = await prisma.commissionStatement.findFirst({
    where: { id: input.statementId, partnerId: input.partnerId },
    select: {
      id: true,
      status: true,
      supersededBy: true,
      partnerId: true,
      periodFrom: true,
      periodTo: true,
    },
  });
  if (!statement) return { ok: false, error: 'not_found' };
  if (statement.supersededBy) {
    return { ok: false, error: 'lifecycle_violation' };
  }
  if (statement.status !== 'draft') {
    return { ok: false, error: 'lifecycle_violation' };
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.commissionStatement.update({
      where: { id: statement.id },
      data: {
        status: 'approved',
        approvedByUserId: input.approvedByUserId,
        approvedAt: now,
      },
    });
    // A6/§9.5: если строки-корректировки увели итог в минус (зажим R2 при выплате),
    // непокрытый остаток переносим синтетической applied-корректировкой в след. период.
    const lines = await tx.commissionStatementItem.findMany({
      where: { statementId: statement.id },
      select: { commissionAmount: true, correctionId: true },
    });
    const hasCorrections = lines.some((l) => l.correctionId !== null);
    if (hasCorrections) {
      const ZERO = new Prisma.Decimal(0);
      const raw = lines.reduce((s, l) => s.plus(l.commissionAmount), ZERO);
      if (raw.lt(0)) {
        const remainder = raw.negated();
        const parentId = lines.find((l) => l.correctionId)?.correctionId ?? null;
        await tx.commissionCorrection.create({
          data: {
            partnerId: statement.partnerId,
            paymentId: null,
            originalStatementId: statement.id,
            originalPeriodFrom: statement.periodFrom,
            originalPeriodTo: statement.periodTo,
            amount: remainder,
            rate: ZERO,
            commissionAmount: remainder,
            status: 'applied',
            parentCorrectionId: parentId,
            carriedReason: `Перенос остатка удержания из ведомости ${statement.id}`,
          },
        });
      }
    }
    await recordAudit(tx, {
      userId: input.approvedByUserId,
      action: 'commission_statement_approved',
      entity: 'commission_statement',
      entityId: statement.id,
      after: { partnerId: input.partnerId, approvedAt: now.toISOString() },
    });
    return result;
  });

  return { ok: true, statement: updated };
}

/**
 * Platform admin marks an approved statement as paid. Transition: approved → paid.
 * RBAC: caller must be a User with role='admin'. Not partner-admin — this is the
 * platform side acknowledging actual money transfer.
 */
export async function markStatementPaid(
  prisma: PrismaClient,
  input: MarkPaidInput
): Promise<
  | { ok: true; statement: CommissionStatement }
  | { ok: false; error: 'forbidden' | 'not_found' | 'lifecycle_violation' }
> {
  const payer = await prisma.user.findUnique({
    where: { id: input.paidByUserId },
    select: { role: true },
  });
  if (!payer) return { ok: false, error: 'forbidden' };
  if (payer.role !== 'admin') {
    return { ok: false, error: 'forbidden' };
  }

  const statement = await prisma.commissionStatement.findUnique({
    where: { id: input.statementId },
    select: {
      id: true,
      status: true,
      supersededBy: true,
      partnerId: true,
    },
  });
  if (!statement) return { ok: false, error: 'not_found' };
  if (statement.supersededBy) {
    return { ok: false, error: 'lifecycle_violation' };
  }
  if (statement.status !== 'approved') {
    return { ok: false, error: 'lifecycle_violation' };
  }

  const paidAt = input.paidAt ?? new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.commissionStatement.update({
      where: { id: statement.id },
      data: {
        status: 'paid',
        paidAt,
      },
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

  return { ok: true, statement: updated };
}
