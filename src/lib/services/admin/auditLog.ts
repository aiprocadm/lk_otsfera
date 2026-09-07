import type { PrismaClient, Prisma } from '@prisma/client';
import type { AuditEntity } from '@/lib/auth/audit';

export type AuditFiltersOptions = {
  entities: AuditEntity[];
  actions: string[];
  actors: Array<{ id: string; name: string; email: string }>;
};

// Фильтры списка: «ключа нет» и «ключ = undefined» — одно и то же (не фильтровать).
// Поэтому поля явно допускают undefined при exactOptionalPropertyTypes.
export type AuditFilters = {
  entity?: AuditEntity | undefined;
  action?: string | undefined;
  actorUserId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  q?: string | undefined;
  take?: number | undefined; // default 50, max 100
  cursor?: string | undefined; // id of last seen, exclusive
};

export type AuditRow = {
  id: string;
  createdAt: Date;
  actor: { id: string; email: string; name: string } | null;
  action: string;
  entity: AuditEntity;
  entityId: string;
  meta: Prisma.JsonValue | null;
};

export async function listAudit(
  prisma: PrismaClient,
  filters: AuditFilters
): Promise<{ rows: AuditRow[]; nextCursor: string | null }> {
  const take = Math.min(Math.max(filters.take ?? 50, 1), 100);

  const where: Prisma.AuditLogWhereInput = {};
  if (filters.entity) where.entity = filters.entity;
  if (filters.action) where.action = filters.action;
  if (filters.actorUserId) where.userId = filters.actorUserId;
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) (where.createdAt as Prisma.DateTimeFilter).gte = filters.from;
    if (filters.to) (where.createdAt as Prisma.DateTimeFilter).lte = filters.to;
  }
  if (filters.q) {
    // Prisma's JsonFilter cannot full-text search a JSON object — the previous
    // `meta string_contains` matched nothing on a real DB, so the search box
    // silently returned zero rows. Run a parameterised raw scan of meta::text
    // and constrain the main query to the matching ids, keeping every other
    // filter + cursor pagination intact.
    const like = `%${filters.q}%`;
    const matches = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "AuditLog" WHERE meta::text ILIKE ${like}
    `;
    where.id = { in: matches.map((m) => m.id) };
  }

  const rows = await prisma.auditLog.findMany({
    where,
    include: { user: { select: { id: true, email: true, name: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1, // +1 to detect whether a next page exists
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });

  let nextCursor: string | null = null;
  if (rows.length > take) {
    rows.pop();
    // take >= 1 (клампится выше), а сюда попадаем при rows.length > take —
    // после pop в массиве остаётся минимум один элемент.
    nextCursor = rows[rows.length - 1]!.id;
  }

  return {
    rows: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      actor: r.user ? { id: r.user.id, email: r.user.email, name: r.user.name } : null,
      action: r.action,
      entity: r.entity as AuditEntity,
      entityId: r.entityId,
      meta: r.meta,
    })),
    nextCursor,
  };
}

/**
 * Сколько разных исполнителей показать в фильтре. Больше двух сотен человек
 * в выпадающем списке всё равно не выбирают глазами — там поиск по имени.
 */
const AUDIT_ACTOR_CAP = 200;

export async function listAuditFilters(prisma: PrismaClient): Promise<AuditFiltersOptions> {
  /**
   * `groupBy`, а НЕ `findMany({ distinct })`.
   *
   * Prisma выполняет `distinct` в памяти приложения: в базу уходит обычный
   * `SELECT id, action FROM "AuditLog"` вообще без `DISTINCT` и без `LIMIT`
   * (даже когда указан `take` — он тоже применяется уже после), и весь
   * журнал аудита едет в процесс, чтобы отдать десяток значений для
   * выпадающего списка. Журнал — самая быстрорастущая таблица: пишется на
   * каждое значимое действие. `groupBy` уходит в базу настоящим `GROUP BY`
   * и возвращает ровно группы (сопровождение `С-8`, 07.09.2026, хотфикс №17).
   */
  const [entityRows, actionRows, actorIds] = await Promise.all([
    prisma.auditLog.groupBy({ by: ['entity'], orderBy: { entity: 'asc' } }),
    prisma.auditLog.groupBy({ by: ['action'], orderBy: { action: 'asc' } }),
    prisma.auditLog.groupBy({
      by: ['userId'],
      orderBy: { userId: 'asc' },
      take: AUDIT_ACTOR_CAP,
    }),
  ]);
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds.map((r) => r.userId) } },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      })
    : [];

  return {
    entities: entityRows.map((r) => r.entity as AuditEntity),
    actions: actionRows.map((r) => r.action),
    actors,
  };
}
