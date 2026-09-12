import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { isManagerLeader } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { resolveEffectiveRate, type RateChange, type OrgRateChange } from './rateResolve';

const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

/** Разложить одну выборку по ключу — порядок внутри группы сохраняется. */
function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
}

/**
 * A6/§9.5: находит возвраты (isRefund), чей paidAt попал в УЖЕ закрытый
 * (approved/paid, живой) период партнёра и ещё не имеет корректировки. Создаёт
 * needs_review-корректировку (идемпотентно по paymentId @unique). Возвраты в
 * draft-период не трогаются — это обычная отрицательная строка (SP-1).
 */
export async function detectLateRefundCorrections(prisma: PrismaClient): Promise<number> {
  const refunds = await prisma.payment.findMany({
    // `CommissionCorrection.partnerId` обязателен: возврат, у которого партнёра
    // нет ни у заказа, ни у организации, корректировки не получит НИКОГДА.
    // Без этого условия такие возвраты оставались в выборке навсегда и
    // перечитывались каждым прогоном — работа росла вместе с базой.
    where: {
      isRefund: true,
      commissionCorrection: { is: null },
      OR: [{ order: { partnerId: { not: null } } }, { organization: { partnerId: { not: null } } }],
    },
    select: {
      id: true,
      amount: true,
      paidAt: true,
      orderId: true,
      organizationId: true,
      order: { select: { partnerId: true } },
      // A2 (§6.2): сторно возврата считаем по эффективной ставке. Override
      // организации резолвится по истории на paidAt (F4) → совпадает с исходным
      // платежом того же периода.
      // Для исторической ставки партнёра у возврата нет ссылки на исходный платёж
      // (в схеме нет refund→original), поэтому берём ставку на дату ВОЗВРАТА как
      // прокси: в общем случае (смена ставки на границе месяца) она совпадает с
      // исходной, т.к. период — календарный месяц.
      organization: { select: { partnerId: true, partnerCommissionRate: true } },
    },
  });

  // Всё, что нужно для расчёта, спрашиваем ОДИН раз на прогон, а не на строку:
  // период, партнёр и обе истории ставок повторяются у большинства возвратов, а
  // запрос в цикле делал работу пропорциональной числу строк.
  const partnerIds = [
    ...new Set(
      refunds
        .map((r) => r.order?.partnerId ?? r.organization?.partnerId ?? null)
        .filter((id): id is string => id !== null)
    ),
  ];
  const orgIds = [...new Set(refunds.map((r) => r.organizationId))];

  const [statements, partners, allChanges, allOrgChanges] = await Promise.all([
    prisma.commissionStatement.findMany({
      where: {
        partnerId: { in: partnerIds },
        supersededBy: null,
        status: { in: ['approved', 'paid'] },
      },
      select: { id: true, partnerId: true, periodFrom: true, periodTo: true },
      // Порядок делает выбор периода воспроизводимым: прежний `findFirst` без
      // `orderBy` при двух подходящих периодах возвращал произвольный.
      orderBy: { periodFrom: 'asc' },
    }),
    prisma.partner.findMany({
      where: { id: { in: partnerIds } },
      select: { id: true, commissionRate: true },
    }),
    prisma.commissionRateChange.findMany({
      where: { partnerId: { in: partnerIds } },
      select: { partnerId: true, effectiveFrom: true, oldRate: true, newRate: true },
      orderBy: { effectiveFrom: 'asc' },
    }),
    // F4 (A5): org-override на дату возврата — из истории (зеркало statement.ts).
    prisma.organizationCommissionRateChange.findMany({
      where: { organizationId: { in: orgIds } },
      select: { organizationId: true, effectiveFrom: true, oldRate: true, newRate: true },
      orderBy: { effectiveFrom: 'asc' },
    }),
  ]);

  const statementsByPartner = groupBy(statements, (s) => s.partnerId);
  const rateByPartner = new Map(partners.map((p) => [p.id, p.commissionRate]));
  const changesByPartner = groupBy(allChanges, (c) => c.partnerId);
  const orgChangesByOrg = groupBy(allOrgChanges, (c) => c.organizationId);

  let created = 0;
  for (const r of refunds) {
    const partnerId = r.order?.partnerId ?? r.organization?.partnerId ?? null;
    if (!partnerId) continue;

    const stmt = (statementsByPartner.get(partnerId) ?? []).find(
      (s) => s.periodFrom <= r.paidAt && s.periodTo >= r.paidAt
    );
    if (!stmt) continue;

    const changes: RateChange[] = changesByPartner.get(partnerId) ?? [];
    const orgChanges: OrgRateChange[] = orgChangesByOrg.get(r.organizationId) ?? [];
    const rate = resolveEffectiveRate({
      // Honor the org override only when the org belongs to the resolved partner
      // (mirror statement.ts: a payment can be attributed via order.partnerId to a
      // different partner than the org's own). F4: the same gate zeroes the history
      // (empty list, not undefined) so a foreign org's timeline never applies.
      orgOverride:
        r.organization?.partnerId === partnerId
          ? (r.organization?.partnerCommissionRate ?? null)
          : null,
      orgChanges: r.organization?.partnerId === partnerId ? orgChanges : [],
      changes,
      paidAt: r.paidAt,
      partnerDefault: rateByPartner.get(partnerId) ?? new Prisma.Decimal(0),
    });
    const commissionAmount = r.amount.mul(rate).toDecimalPlaces(2, HALF_UP);

    try {
      await prisma.commissionCorrection.create({
        data: {
          partnerId,
          paymentId: r.id,
          originalStatementId: stmt.id,
          originalPeriodFrom: stmt.periodFrom,
          originalPeriodTo: stmt.periodTo,
          amount: r.amount,
          rate,
          commissionAmount,
          status: 'needs_review',
        },
      });
      created++;
    } catch (err) {
      if (!(
        typeof err === 'object' &&
        err &&
        'code' in err &&
        (err as { code?: unknown }).code === 'P2002'
      ))
        throw err;
    }
  }
  return created;
}

// ── A6/§9.5: Queue listing + manual resolve ───────────────────────────────────

export type CorrectionError = 'forbidden' | 'not_found' | 'invalid_state' | 'reason_required';

/** admin или руководитель (role='leader') могут разбирать очередь. */
function canResolve(s: SessionPayload): boolean {
  return s.role === 'admin' || isManagerLeader(s);
}

/**
 * Список корректировок со статусом needs_review.
 * Admin видит все; leader ограничен партнёрами своей компании
 * (через partner→organizations.companyId).
 *
 * `С-6`: окно 200 строк, рядом `total` по тому же условию — экран покажет
 * «показаны 200 из M», а не выдаст окно за всю очередь.
 */
export async function listCorrectionQueue(prisma: PrismaClient, session: SessionPayload) {
  if (!canResolve(session)) return { rows: [], total: 0 };
  const where: Prisma.CommissionCorrectionWhereInput =
    session.role === 'admin'
      ? { status: 'needs_review' }
      : {
          status: 'needs_review',
          partner: { organizations: { some: { companyId: session.companyId ?? '__none__' } } },
        };
  const [rows, total] = await Promise.all([
    prisma.commissionCorrection.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        partnerId: true,
        amount: true,
        commissionAmount: true,
        rate: true,
        originalPeriodFrom: true,
        originalPeriodTo: true,
        paymentId: true,
        createdAt: true,
        partner: { select: { name: true } },
      },
    }),
    prisma.commissionCorrection.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Применить (apply → applied) или отклонить (waive → waived) корректировку.
 * waive требует непустой причины. Leader дополнительно проверяется на принадлежность
 * компании. Результат пишется в audit log внутри транзакции.
 */
export async function resolveCorrection(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { correctionId: string; action: 'apply' | 'waive'; reason?: string }
): Promise<{ ok: true } | { ok: false; error: CorrectionError }> {
  if (!canResolve(session)) return { ok: false, error: 'forbidden' };
  if (args.action === 'waive' && !args.reason?.trim())
    return { ok: false, error: 'reason_required' };

  const corr = await prisma.commissionCorrection.findUnique({
    where: { id: args.correctionId },
    select: { id: true, status: true, partnerId: true },
  });
  if (!corr) return { ok: false, error: 'not_found' };
  if (corr.status !== 'needs_review') return { ok: false, error: 'invalid_state' };

  if (isManagerLeader(session)) {
    const inScope = await prisma.commissionCorrection.findFirst({
      where: {
        id: corr.id,
        partner: { organizations: { some: { companyId: session.companyId ?? '__none__' } } },
      },
      select: { id: true },
    });
    if (!inScope) return { ok: false, error: 'forbidden' };
  }

  const next = args.action === 'apply' ? 'applied' : 'waived';
  await prisma.$transaction(async (tx) => {
    await tx.commissionCorrection.update({
      where: { id: corr.id },
      data: {
        status: next,
        reason: args.reason ?? null,
        resolvedByUserId: session.sub,
        resolvedAt: new Date(),
      },
    });
    await recordAudit(tx, {
      userId: session.sub,
      action: `commission_correction_${next}`,
      entity: 'commission_correction',
      entityId: corr.id,
      after: { partnerId: corr.partnerId, action: args.action },
      reason: args.reason,
    });
  });
  return { ok: true };
}
