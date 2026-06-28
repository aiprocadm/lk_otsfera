import type { PrismaClient, Prisma } from '@prisma/client';
import type { AuditEntity } from '@/lib/auth/audit';

export type AuditFiltersOptions = {
  entities: AuditEntity[];
  actions: string[];
  actors: Array<{ id: string; name: string; email: string }>;
};

export type AuditFilters = {
  entity?: AuditEntity;
  action?: string;
  actorUserId?: string;
  from?: Date;
  to?: Date;
  q?: string;
  take?: number;     // default 50, max 100
  cursor?: string;   // id of last seen, exclusive
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
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {})
  });

  let nextCursor: string | null = null;
  if (rows.length > take) {
    rows.pop();
    nextCursor = rows[rows.length - 1].id;
  }

  return {
    rows: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      actor: r.user ? { id: r.user.id, email: r.user.email, name: r.user.name } : null,
      action: r.action,
      entity: r.entity as AuditEntity,
      entityId: r.entityId,
      meta: r.meta
    })),
    nextCursor
  };
}

export async function listAuditFilters(
  prisma: PrismaClient
): Promise<AuditFiltersOptions> {
  const [entityRows, actionRows, actorIds] = await Promise.all([
    prisma.auditLog.findMany({
      distinct: ['entity'],
      select: { entity: true },
      orderBy: { entity: 'asc' }
    }),
    prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' }
    }),
    prisma.auditLog.findMany({
      distinct: ['userId'],
      select: { userId: true },
      take: 200
    })
  ]);
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds.map((r) => r.userId) } },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' }
      })
    : [];

  return {
    entities: entityRows.map((r) => r.entity as AuditEntity),
    actions: actionRows.map((r) => r.action),
    actors
  };
}
