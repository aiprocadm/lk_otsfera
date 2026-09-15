import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { isManagerLeader } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { log } from '@/lib/logging';
import { resolveEffectiveRate, type RateChange, type OrgRateChange } from './rateResolve';

const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

/**
 * Сколько закрытых периодов берём за заход. Период — это месяц одного
 * партнёра: пятисот хватает на годы работы сотни партнёров, а предел не даёт
 * задаче держать соединение на растущей базе (образец — `expire-proposals`).
 */
const CLOSED_PERIOD_LIMIT = 500;

/** Сколько поздних возвратов разбираем за заход; остаток добьётся следующим. */
const LATE_REFUND_BATCH_LIMIT = 500;

/**
 * Возврат принадлежит партнёру, если так говорит его заказ, а если заказа (или
 * партнёра в заказе) нет — организация. Это `order?.partnerId ??
 * organization?.partnerId` из разбора строки, переписанное условием базы:
 * иначе пришлось бы прочитать ВСЕ возвраты и отсеивать чужих в памяти.
 */
function refundBelongsTo(partnerId: string): Prisma.PaymentWhereInput {
  return {
    OR: [
      { order: { partnerId } },
      {
        AND: [
          { OR: [{ orderId: null }, { order: { partnerId: null } }] },
          { organization: { partnerId } },
        ],
      },
    ],
  };
}

function groupBy<T, K extends keyof T>(rows: T[], key: K): Map<T[K], T[]> {
  const grouped = new Map<T[K], T[]>();
  for (const row of rows) {
    const list = grouped.get(row[key]);
    if (list) list.push(row);
    else grouped.set(row[key], [row]);
  }
  return grouped;
}

/**
 * A6/§9.5: находит возвраты (isRefund), чей paidAt попал в УЖЕ закрытый
 * (approved/paid, живой) период партнёра и ещё не имеет корректировки. Создаёт
 * needs_review-корректировку (идемпотентно по paymentId @unique). Возвраты в
 * draft-период не трогаются — это обычная отрицательная строка (SP-1).
 *
 * Порционность (`С-8`, хотфикс №49). Идём ОТ ЗАКРЫТЫХ ПЕРИОДОВ, а не от
 * возвратов: база возвращает только те строки, которым корректировка
 * действительно положена. Прежняя выборка брала все возвраты без корректировки
 * без предела — а это в основном обычные отрицательные строки открытого
 * периода и возвраты без партнёра: корректировку они не получали никогда и
 * перечитывались каждым заходом, по три запроса на строку.
 */
export async function detectLateRefundCorrections(prisma: PrismaClient): Promise<number> {
  const periods = await prisma.commissionStatement.findMany({
    where: { supersededBy: null, status: { in: ['approved', 'paid'] } },
    select: { id: true, partnerId: true, periodFrom: true, periodTo: true },
    orderBy: [{ periodTo: 'desc' }, { id: 'asc' }],
    take: CLOSED_PERIOD_LIMIT,
  });
  if (periods.length === 0) return 0;
  if (periods.length === CLOSED_PERIOD_LIMIT) {
    log.warn('[commission/corrections] закрытых периодов больше, чем берём за заход', {
      limit: CLOSED_PERIOD_LIMIT,
    });
  }

  const refunds = await prisma.payment.findMany({
    where: {
      isRefund: true,
      commissionCorrection: { is: null },
      OR: periods.map((p) => ({
        paidAt: { gte: p.periodFrom, lte: p.periodTo },
        ...refundBelongsTo(p.partnerId),
      })),
    },
    // Устойчивый порядок (`С-8`, хотфиксы №28…№32): при равных `paidAt` ключом
    // второго уровня служит id, иначе соседние заходы видят разные пачки.
    orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
    take: LATE_REFUND_BATCH_LIMIT,
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
  if (refunds.length === 0) return 0;
  if (refunds.length === LATE_REFUND_BATCH_LIMIT) {
    log.warn('[commission/corrections] поздних возвратов больше, чем берём за заход', {
      limit: LATE_REFUND_BATCH_LIMIT,
    });
  }

  const partnerIdOf = (r: (typeof refunds)[number]): string | null =>
    r.order?.partnerId ?? r.organization?.partnerId ?? null;

  // Ставки на всю пачку — тремя запросами вместо трёх на каждую строку.
  const partnerIds = [...new Set(refunds.map(partnerIdOf).filter((id): id is string => !!id))];
  const organizationIds = [...new Set(refunds.map((r) => r.organizationId))];
  const [partners, rateChanges, orgRateChanges] = await Promise.all([
    prisma.partner.findMany({
      where: { id: { in: partnerIds } },
      select: { id: true, commissionRate: true },
    }),
    prisma.commissionRateChange.findMany({
      where: { partnerId: { in: partnerIds } },
      select: { partnerId: true, effectiveFrom: true, oldRate: true, newRate: true },
      orderBy: { effectiveFrom: 'asc' },
    }),
    prisma.organizationCommissionRateChange.findMany({
      where: { organizationId: { in: organizationIds } },
      select: { organizationId: true, effectiveFrom: true, oldRate: true, newRate: true },
      orderBy: { effectiveFrom: 'asc' },
    }),
  ]);
  const defaultRateOf = new Map(partners.map((p) => [p.id, p.commissionRate]));
  const changesOf = groupBy(rateChanges, 'partnerId');
  const orgChangesOf = groupBy(orgRateChanges, 'organizationId');

  let created = 0;
  for (const r of refunds) {
    const partnerId = partnerIdOf(r);
    if (!partnerId) continue;

    // Период возврата — тот, по которому его и выбрала база. Порядок перебора
    // задан (periodTo desc, id asc), поэтому при наложении периодов выбор
    // повторяем, а не «какой попало», как у прежнего findFirst без orderBy.
    const stmt = periods.find(
      (p) => p.partnerId === partnerId && p.periodFrom <= r.paidAt && p.periodTo >= r.paidAt
    );
    if (!stmt) continue;

    const changes: RateChange[] = changesOf.get(partnerId) ?? [];
    // F4 (A5): org-override на дату возврата — из истории (зеркало statement.ts).
    const orgChanges: OrgRateChange[] = orgChangesOf.get(r.organizationId) ?? [];
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
      partnerDefault: defaultRateOf.get(partnerId) ?? new Prisma.Decimal(0),
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
