import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { PII_CONTEXTS, type PiiContextKey, type PiiSubjectType } from '@/lib/pii/contexts';

export type PiiAccessFilters = {
  actorUserId?: string;
  userRole?: string;
  context?: PiiContextKey;
  subjectType?: PiiSubjectType;
  subjectId?: string; // точный id — GIN `has`, «кто смотрел субъекта X»
  from?: Date;
  to?: Date;
  take?: number; // default 50, max 100
  cursor?: string;
};

export type PiiAccessRow = {
  id: string;
  createdAt: Date;
  actor: { id: string; email: string; name: string } | null;
  userRole: string;
  context: string;
  labelRu: string;
  action: string;
  subjectType: string;
  subjectCount: number;
  subjects: Array<{ id: string; label: string }>;
  meta: Prisma.JsonValue | null;
};

type ListOk = { ok: true; rows: PiiAccessRow[]; nextCursor: string | null };
type Forbidden = { ok: false; error: 'forbidden' };

const EVENT_INCLUDE = {
  user: { select: { id: true, email: true, name: true } },
} satisfies Prisma.PiiAccessEventInclude;

type EventRow = Prisma.PiiAccessEventGetPayload<{ include: typeof EVENT_INCLUDE }>;

/** Батч-резолв subjectId → человекочитаемый лейбл (константное число запросов). */
async function resolveSubjectLabels(
  prisma: PrismaClient,
  rows: EventRow[]
): Promise<Map<string, string>> {
  const byType = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = byType.get(r.subjectType) ?? new Set<string>();
    for (const id of r.subjectIds) set.add(id);
    byType.set(r.subjectType, set);
  }
  const labels = new Map<string, string>();
  const put = (id: string, label: string | null | undefined) => {
    if (label) labels.set(id, label);
  };
  // ids() вызывается только внутри byType.has(t)-гардов — get() не бывает
  // undefined; ?? [] — защитный fallback на случай будущего рефактора.
  /* v8 ignore next */
  const ids = (t: string) => [...(byType.get(t) ?? [])];

  if (byType.has('student')) {
    for (const s of await prisma.student.findMany({
      where: { id: { in: ids('student') } },
      select: { id: true, name: true },
    }))
      put(s.id, s.name);
  }
  if (byType.has('user')) {
    for (const u of await prisma.user.findMany({
      where: { id: { in: ids('user') } },
      select: { id: true, name: true },
    }))
      put(u.id, u.name);
  }
  if (byType.has('lead')) {
    for (const l of await prisma.lead.findMany({
      where: { id: { in: ids('lead') } },
      select: { id: true, clientContactName: true },
    }))
      put(l.id, l.clientContactName);
  }
  if (byType.has('enrollment_request')) {
    // Этап 2: слушатели живут в позициях — подписываем заявку первым слушателем.
    for (const e of await prisma.enrollmentRequest.findMany({
      where: { id: { in: ids('enrollment_request') } },
      select: {
        id: true,
        items: { orderBy: { createdAt: 'asc' }, take: 1, select: { fullName: true } },
      },
    }))
      put(e.id, e.items[0]?.fullName ?? '—');
  }
  if (byType.has('caller')) {
    for (const c of await prisma.call.findMany({
      where: { id: { in: ids('caller') } },
      select: { id: true, callerNumber: true },
    }))
      put(c.id, c.callerNumber);
  }
  if (byType.has('inbound_sender')) {
    for (const m of await prisma.inboundMessage.findMany({
      where: { id: { in: ids('inbound_sender') } },
      select: { id: true, senderDisplay: true },
    }))
      put(m.id, m.senderDisplay);
  }
  return labels;
}

export async function listPiiAccess(
  prisma: PrismaClient,
  session: SessionPayload,
  filters: PiiAccessFilters
): Promise<ListOk | Forbidden> {
  if (session.role !== 'admin') return { ok: false, error: 'forbidden' };

  const take = Math.min(Math.max(filters.take ?? 50, 1), 100);
  const where: Prisma.PiiAccessEventWhereInput = {};
  if (filters.actorUserId) where.userId = filters.actorUserId;
  if (filters.userRole) where.userRole = filters.userRole;
  if (filters.context) where.context = filters.context;
  if (filters.subjectType) where.subjectType = filters.subjectType;
  if (filters.subjectId) where.subjectIds = { has: filters.subjectId };
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) (where.createdAt as Prisma.DateTimeFilter).gte = filters.from;
    if (filters.to) (where.createdAt as Prisma.DateTimeFilter).lte = filters.to;
  }

  const rows = await prisma.piiAccessEvent.findMany({
    where,
    include: EVENT_INCLUDE,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });

  let nextCursor: string | null = null;
  if (rows.length > take) {
    rows.pop();
    // take >= 1 (клампится выше), а сюда попадаем при rows.length > take —
    // после pop в массиве остаётся минимум один элемент.
    nextCursor = rows[rows.length - 1]!.id;
  }

  const labels = await resolveSubjectLabels(prisma, rows);

  return {
    ok: true,
    rows: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      actor: r.user ? { id: r.user.id, email: r.user.email, name: r.user.name } : null,
      userRole: r.userRole,
      context: r.context,
      labelRu: PII_CONTEXTS[r.context as PiiContextKey]?.labelRu ?? r.context,
      action: r.action,
      subjectType: r.subjectType,
      subjectCount: r.subjectCount,
      subjects: r.subjectIds.map((id) => ({ id, label: labels.get(id) ?? `${id} (удалён)` })),
      meta: r.meta,
    })),
    nextCursor,
  };
}

export type PiiAccessFilterOptions = {
  ok: true;
  contexts: Array<{ key: PiiContextKey; labelRu: string }>;
  subjectTypes: PiiSubjectType[];
  actors: Array<{ id: string; name: string; email: string }>;
};

export async function listPiiAccessFilters(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<PiiAccessFilterOptions | Forbidden> {
  if (session.role !== 'admin') return { ok: false, error: 'forbidden' };
  const actorIds = await prisma.piiAccessEvent.findMany({
    distinct: ['userId'],
    select: { userId: true },
    take: 200,
  });
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds.map((r) => r.userId) } },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      })
    : [];
  const contexts = (Object.keys(PII_CONTEXTS) as PiiContextKey[]).map((key) => ({
    key,
    labelRu: PII_CONTEXTS[key].labelRu,
  }));
  const subjectTypes = [...new Set(Object.values(PII_CONTEXTS).map((c) => c.subjectType))];
  return { ok: true, contexts, subjectTypes, actors };
}
