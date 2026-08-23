import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { listQueue, listQueueOrgNames, QUEUE_PAGE_SIZE, type QueueQuery } from './resolve-queue';

/**
 * Страница очереди ручного разбора для экрана (`У-90`).
 *
 * Живёт в lib, а не в трёх страницах кабинетов: разбор адреса и приведение
 * строки к виду для экрана одинаковы у admin, leader и manager, и раньше это
 * был буквальный тройной дубль. Страницы остаются тонкими (CLAUDE.md §2).
 */
export type QueueSearchParams = Record<string, string | string[] | undefined>;

/** Строка очереди в том виде, в каком её рисует экран. */
export type QueueRow = {
  id: string;
  externalId: string;
  paidAt: string;
  amount: string;
  isRefund: boolean;
  purpose: string | null;
  counterpartyName: string | null;
  counterpartyInn: string | null;
  /** `У-83`: ключ контрагента — по нему строки группируются в таблице. */
  counterpartyKey: string | null;
  accountCandidates: string[];
  candidateOrgId: string | null;
  candidateOrgName: string | null;
  candidateOrderId: string | null;
  matchMethod: string | null;
  batchCompanyId: string | null;
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function oneOf<T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.includes(v as T) ? (v as T) : undefined;
}

/**
 * Разбор параметров адреса. Мусор игнорируется, а не превращается в ошибку:
 * подчищенный адрес всё равно открывает первую страницу очереди.
 */
export function parseQueueQuery(sp: QueueSearchParams): QueueQuery & { take: number; skip: number } {
  const takeRaw = Number(first(sp.take));
  const skipRaw = Number(first(sp.skip));
  const take = Number.isFinite(takeRaw) && takeRaw > 0 ? Math.floor(takeRaw) : QUEUE_PAGE_SIZE;
  const skip = Number.isFinite(skipRaw) && skipRaw > 0 ? Math.floor(skipRaw) : 0;
  const inn = oneOf(first(sp.inn), ['with', 'without'] as const);
  const candidate = oneOf(first(sp.candidate), ['org', 'order'] as const);
  const sort = oneOf(first(sp.sort), ['date', 'amount', 'counterparty'] as const);
  const dir = oneOf(first(sp.dir), ['asc', 'desc'] as const);
  return {
    take,
    skip,
    ...(inn ? { inn } : {}),
    ...(candidate ? { candidate } : {}),
    ...(sort ? { sort } : {}),
    ...(dir ? { dir } : {}),
  };
}

export async function loadQueuePage(
  prisma: PrismaClient,
  session: SessionPayload,
  sp: QueueSearchParams
): Promise<{ rows: QueueRow[]; total: number; take: number; skip: number }> {
  const query = parseQueueQuery(sp);
  const { rows, total } = await listQueue(prisma, session, query);
  const orgIds = rows.map((r) => r.candidateOrgId).filter((x): x is string => !!x);
  const orgName = await listQueueOrgNames(prisma, orgIds);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      externalId: r.externalId,
      paidAt: r.paidAt.toISOString(),
      amount: String(r.amount),
      isRefund: r.isRefund,
      purpose: r.purpose,
      counterpartyName: r.counterpartyName,
      counterpartyInn: r.counterpartyInn,
      counterpartyKey: r.counterpartyKey,
      accountCandidates: (r.accountCandidates as string[]) ?? [],
      candidateOrgId: r.candidateOrgId,
      candidateOrgName: r.candidateOrgId ? (orgName.get(r.candidateOrgId) ?? null) : null,
      candidateOrderId: r.candidateOrderId,
      matchMethod: r.matchMethod,
      batchCompanyId: r.batch.companyId,
    })),
    total,
    take: query.take,
    skip: query.skip,
  };
}
