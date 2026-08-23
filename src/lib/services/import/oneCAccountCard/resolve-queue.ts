import type { PrismaClient } from '@prisma/client';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';
import { upsertPaymentRecord, type WriteCtx } from '@/lib/services/oneCSync/writers';
import { emptySummary } from '@/lib/services/oneCSync/record-batch';
import { importScope } from '@/lib/services/oneCSync/scope';
import type { OneCPaymentDto } from '@/lib/services/oneCSync/dto';

const EPOCH = new Date(0).toISOString();
type Err = 'forbidden' | 'not_found' | 'org_required' | 'write_skipped';
function isStaff(s: SessionPayload) {
  return s.role === 'admin' || isStaffManagerSide(s);
}

/** C8: a non-admin may act on a queue row only when its batch belongs to their company.
 *  Mirrors listQueue's `batch.companyId === session.companyId` read scope so the write
 *  path cannot mutate another company's rows (admin is unscoped — Model A). A session
 *  without a companyId is denied (fail-safe, §4) — never matched against a null-company
 *  batch via `null === null`, matching listQueue's `'__none__'` sentinel. */
function rowInCompanyScope(
  s: SessionPayload,
  row: { batch: { companyId: string | null } }
): boolean {
  return s.role === 'admin' || (!!s.companyId && row.batch.companyId === s.companyId);
}

/**
 * Запрос очереди ручного разбора (`У-90`). Всё необязательно: без параметров —
 * первая страница по 50 строк, порядок «свежие сверху».
 */
export type QueueQuery = {
  take?: number;
  skip?: number;
  /** `with` — только строки с ИНН, `without` — только без него. */
  inn?: 'with' | 'without';
  /** Есть предложенный кандидат: организация или заказ. */
  candidate?: 'org' | 'order';
  sort?: 'date' | 'amount' | 'counterparty';
  dir?: 'asc' | 'desc';
};

export const QUEUE_PAGE_SIZE = 50;
const QUEUE_MAX_TAKE = 200;

function queueOrderBy(q: QueueQuery) {
  const dir = q.dir ?? 'desc';
  if (q.sort === 'amount') return { amount: dir };
  if (q.sort === 'date') return { paidAt: dir };
  // По контрагенту сортируем по КЛЮЧУ (`У-83`): варианты написания одного
  // названия обязаны встать рядом, иначе группировка в UI разъедется.
  if (q.sort === 'counterparty')
    return [{ counterpartyKey: q.dir ?? 'asc' }, { paidAt: 'desc' as const }];
  return { createdAt: dir };
}

function queueWhere(session: SessionPayload, q: QueueQuery) {
  const where: Record<string, unknown> = { status: 'needs_review' };
  // C8: не-админ видит только батчи своей компании; сессия без компании —
  // deny-all через sentinel (никогда не `null === null`).
  if (session.role !== 'admin') where.batch = { companyId: session.companyId ?? '__none__' };
  if (q.inn === 'with') where.counterpartyInn = { not: null };
  if (q.inn === 'without') where.counterpartyInn = null;
  if (q.candidate === 'org') where.candidateOrgId = { not: null };
  if (q.candidate === 'order') where.candidateOrderId = { not: null };
  return where;
}

/**
 * Страница очереди ручного разбора со счётчиком (scoped по компании для
 * не-админа). Прежняя выдача была `take: 200` без счётчика: при большой
 * очереди человек видел первые 200 строк и не знал, что есть ещё (`У-90` —
 * молчаливое усечение списка это дефект, CLAUDE.md §16).
 */
export async function listQueue(prisma: PrismaClient, session: SessionPayload, query: QueueQuery = {}) {
  if (!isStaff(session)) return { rows: [], total: 0 };
  const where = queueWhere(session, query);
  const take = Math.min(Math.max(query.take ?? QUEUE_PAGE_SIZE, 1), QUEUE_MAX_TAKE);
  const skip = Math.max(query.skip ?? 0, 0);
  const [rows, total] = await Promise.all([
    prisma.paymentImportRow.findMany({
      where,
      orderBy: queueOrderBy(query),
      take,
      skip,
      select: {
        id: true,
        externalId: true,
        paidAt: true,
        amount: true,
        isRefund: true,
        purpose: true,
        counterpartyName: true,
        counterpartyInn: true,
        // `У-83`: ключ контрагента — по нему UI группирует строки.
        counterpartyKey: true,
        accountCandidates: true,
        candidateOrgId: true,
        candidateOrderId: true,
        matchMethod: true,
        // Этап 10 (Т-30): prefill компании в диалоге создания организации.
        batch: { select: { companyId: true } },
      },
    }),
    prisma.paymentImportRow.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Названия организаций-кандидатов для строк очереди разбора.
 *
 * Пустой список id — без запроса в базу (очередь без кандидатов встречается
 * чаще всего). Возвращает готовую карту id → название.
 */
export async function listQueueOrgNames(
  prisma: PrismaClient,
  orgIds: string[]
): Promise<Map<string, string>> {
  if (!orgIds.length) return new Map();
  const orgs = await prisma.organization.findMany({
    where: { id: { in: orgIds } },
    select: { id: true, name: true },
  });
  return new Map(orgs.map((o) => [o.id, o.name]));
}

/** Подтвердить привязку строки очереди → создать Payment через writer, пометить resolved. */
export async function resolveQueueRow(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { rowId: string; organizationId: string; orderId: string | null }
): Promise<{ ok: true; paymentId: string | null } | { ok: false; error: Err }> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  const row = await prisma.paymentImportRow.findUnique({
    where: { id: args.rowId },
    include: { batch: { select: { companyId: true } } },
  });
  if (!row || row.status !== 'needs_review' || !rowInCompanyScope(session, row))
    return { ok: false, error: 'not_found' };
  if (!args.organizationId) return { ok: false, error: 'org_required' };

  const org = await prisma.organization.findUnique({
    where: { id: args.organizationId },
    select: { id: true, inn: true, externalId: true },
  });
  if (!org) return { ok: false, error: 'not_found' };

  // строим DTO: если выбран order и у него есть externalId — order-level, иначе org-level
  let dto: OneCPaymentDto = {
    externalId: row.externalId,
    amount: Number(row.amount),
    paidAt: row.paidAt.toISOString(),
    method: row.isRefund ? 'возврат' : undefined,
    purpose: row.purpose ?? undefined,
    paymentOrderNumber: row.paymentOrderNumber ?? undefined,
    vatAmount: row.vatAmount == null ? undefined : Number(row.vatAmount),
    isRefund: row.isRefund,
    updatedAt: EPOCH,
    organizationInn: org.inn ?? undefined,
    organizationExternalId: org.externalId ?? undefined,
  };
  if (args.orderId) {
    const order = await prisma.order.findUnique({
      where: { id: args.orderId },
      select: { externalId: true },
    });
    if (order?.externalId)
      dto = {
        ...dto,
        orderExternalId: order.externalId,
        organizationInn: undefined,
        organizationExternalId: undefined,
      };
  }

  const ctx: WriteCtx = { mode: 'live', notify: true, scope: importScope(session) };
  const summary = emptySummary();
  await upsertPaymentRecord(prisma, dto, summary, ctx);
  const payment = await prisma.payment.findUnique({
    where: { externalId: row.externalId },
    select: { id: true },
  });
  // writer пропустил запись (org вне scope / нет usable ref) → Payment не создан; оставляем строку в очереди
  if (!payment) return { ok: false, error: 'write_skipped' };
  await prisma.paymentImportRow.update({
    where: { id: row.id },
    data: {
      status: 'resolved',
      candidateOrgId: org.id,
      candidateOrderId: args.orderId,
      resolvedPaymentId: payment.id,
    },
  });
  return { ok: true, paymentId: payment.id };
}

export async function dismissQueueRow(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { rowId: string }
): Promise<{ ok: true } | { ok: false; error: Err }> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  const row = await prisma.paymentImportRow.findUnique({
    where: { id: args.rowId },
    select: { id: true, batch: { select: { companyId: true } } },
  });
  if (!row || !rowInCompanyScope(session, row)) return { ok: false, error: 'not_found' };
  await prisma.paymentImportRow.update({
    where: { id: args.rowId },
    data: { status: 'dismissed' },
  });
  return { ok: true };
}
