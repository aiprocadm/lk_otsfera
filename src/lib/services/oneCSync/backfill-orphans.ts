import type { PrismaClient } from '@prisma/client';

/**
 * Бэкфилл осиротевших Company (ТЗ починки импорта, Т-42).
 *
 * До этапа 6 ветка создания организации минтила НОВУЮ Company с названием
 * клиента (дефект §0.2) — и в файловом импорте, и в сетевой синхронизации.
 * Сигнатура сироты: компания без единого пользователя, у которой ровно одна
 * организация, и её название совпадает с названием компании (writer копировал
 * `name` контрагента).
 *
 * Логика намеренно в сервисном слое (покрытие, честные integration-тесты);
 * CLI-обёртка — `scripts/backfill-orphan-companies.ts` (dry-run по умолчанию).
 * Никакого логирования здесь нет: сервис возвращает данные, печатает CLI.
 */

export type OrphanCandidate = {
  companyId: string;
  companyName: string;
  organizationId: string;
  organizationInn: string | null;
  /** Заказы, всё ещё привязанные к компании-сироте, — переедут вместе с организацией. */
  ordersCount: number;
};

type BackfillOutcome = {
  companyId: string;
  companyName: string;
  ordersMoved: number;
  /** `kept_not_empty` — на компании остались другие записи; она перепривязана, но НЕ удалена. */
  action: 'deleted' | 'kept_not_empty';
};

/**
 * `companyIds` сужает поиск до конкретных компаний — страховка для точечного
 * прогона и для тестов на общей базе (там могут жить чужие сироты, которых
 * трогать нельзя). Без него — полный поиск (путь CLI).
 */
export async function findOrphanCompanies(
  db: PrismaClient,
  opts: { companyIds?: string[] } = {}
): Promise<OrphanCandidate[]> {
  const companies = await db.company.findMany({
    where: {
      users: { none: {} },
      ...(opts.companyIds ? { id: { in: opts.companyIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      organizations: {
        select: { id: true, name: true, inn: true, _count: { select: { orders: true } } },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  const candidates: OrphanCandidate[] = [];
  for (const c of companies) {
    if (c.organizations.length !== 1) continue;
    // Индекс доказуемо валиден: длина проверена строкой выше.
    const org = c.organizations[0]!;
    if (org.name !== c.name) continue;
    candidates.push({
      companyId: c.id,
      companyName: c.name,
      organizationId: org.id,
      organizationInn: org.inn,
      ordersCount: org._count.orders,
    });
  }
  return candidates;
}

export type BackfillResult =
  | { ok: true; outcomes: BackfillOutcome[] }
  | { ok: false; error: 'target_not_found' | 'target_is_orphan' };

/**
 * Применение: организация каждой сироты и её заказы перевешиваются на целевую
 * компанию (одна транзакция на кандидата), затем сирота удаляется — но ТОЛЬКО
 * если все обратные связи Company пусты. Непустая компания остаётся и попадает
 * в отчёт как `kept_not_empty` — удалять «почти пустое» молча нельзя.
 */
export async function applyOrphanBackfill(
  db: PrismaClient,
  args: { targetCompanyId: string; companyIds?: string[] }
): Promise<BackfillResult> {
  const target = await db.company.findUnique({
    where: { id: args.targetCompanyId },
    select: { id: true },
  });
  if (!target) return { ok: false, error: 'target_not_found' };

  const candidates = await findOrphanCompanies(
    db,
    args.companyIds ? { companyIds: args.companyIds } : {}
  );
  if (candidates.some((c) => c.companyId === target.id)) {
    return { ok: false, error: 'target_is_orphan' };
  }

  const outcomes: BackfillOutcome[] = [];
  for (const candidate of candidates) {
    const outcome = await db.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: candidate.organizationId },
        data: { companyId: target.id },
      });
      // Заказы двигаем по ссылке на компанию-сироту, а не «все заказы
      // организации»: заказ, уже живущий в правильной компании, не трогаем.
      const moved = await tx.order.updateMany({
        where: { companyId: candidate.companyId },
        data: { companyId: target.id },
      });
      const counts = await tx.company.findUnique({
        where: { id: candidate.companyId },
        select: {
          _count: {
            select: {
              users: true,
              orders: true,
              organizations: true,
              documents: true,
              accessProfiles: true,
              funnelStages: true,
              deals: true,
              dealStages: true,
              taskColumns: true,
              tasks: true,
              inboundMessages: true,
              calls: true,
              contacts: true,
              salesTargets: true,
              staffConversations: true,
              calendarEvents: true,
            },
          },
        },
      });
      const empty = counts !== null && Object.values(counts._count).every((n) => n === 0);
      if (empty) await tx.company.delete({ where: { id: candidate.companyId } });
      return {
        companyId: candidate.companyId,
        companyName: candidate.companyName,
        ordersMoved: moved.count,
        action: empty ? ('deleted' as const) : ('kept_not_empty' as const),
      };
    });
    outcomes.push(outcome);
  }
  return { ok: true, outcomes };
}
