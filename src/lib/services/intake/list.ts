import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canTriageClientRequests } from '@/lib/services/clientRequests/policy';
import { clientRequestScopeWhere } from '@/lib/services/clientRequests/list';
import { inboxScopeWhere } from '@/lib/services/inbound/scope';
import { recordPiiAccess } from '@/lib/pii/record';

/**
 * Этап 7 (ФТ-8.1) — union-ридер «Входящие в работу»: 4 источника без новой
 * таблицы. Каждый источник читается СВОИМ существующим scope-резолвером
 * (клиентские роли → forbidden), нормализуется в IntakeItem, merge в памяти с
 * сортировкой «дольше всех ждёт — сверху» и пагинацией после merge (cap по
 * источнику). Пороги подсветки — Company.slaWarningHours/slaResponseHours
 * (PR-3, §4.4); константы ниже — фолбэк для сессии без компании.
 */

const INTAKE_WARNING_HOURS = 4;
export const INTAKE_BREACH_HOURS = 24;
const SOURCE_CAP = 200;

export type IntakeType = 'client_request' | 'enrollment' | 'inbound' | 'call';
export type IntakeSlaLevel = 'ok' | 'warning' | 'breach';

export type IntakeItem = {
  type: IntakeType;
  id: string;
  /** От кого: компания/отправитель/номер телефона. */
  from: string;
  /** Суть: тема/направление/канал. */
  essence: string;
  createdAt: Date;
  waitingMs: number;
  slaLevel: IntakeSlaLevel;
  responsibleUserId: string | null;
  responsibleName: string | null;
  /** Куда ведёт «Открыть»: карточка/экран источника. */
  href: string;
  /** Префилл диалога «Создать лид» (только inbound/call). */
  leadPrefill: {
    companyName: string;
    contactName: string;
    contactPhone: string;
    contactEmail: string;
    subject: string;
  } | null;
  /** Префилл быстрой задачи. */
  taskTitle: string;
  organizationId: string | null;
};

export type IntakeFilters = {
  assigneeId?: string | null;
  onlyUnassigned?: boolean;
  page?: number;
  pageSize?: number;
};

export type IntakeResult = { items: IntakeItem[]; total: number };

export function slaLevelFor(
  waitingMs: number,
  warningHours = INTAKE_WARNING_HOURS,
  breachHours = INTAKE_BREACH_HOURS
): IntakeSlaLevel {
  const hours = waitingMs / 3_600_000;
  if (hours > breachHours) return 'breach';
  if (hours > warningHours) return 'warning';
  return 'ok';
}

/** Критерий «звонок не разобран» — входящий, без привязки/лида/закрытия (§4 спеки). */
export function intakeCallWhere(session: SessionPayload): Prisma.CallWhereInput {
  return {
    AND: [
      { OR: [{ companyId: session.companyId ?? '__no_company__' }, { companyId: null }] },
      {
        direction: 'inbound',
        resolvedOrgId: null,
        contactId: null,
        intakeClosedAt: null,
        lead: null,
      },
    ],
  };
}

export function intakeClientRequestWhere(session: SessionPayload): Prisma.ClientRequestWhereInput {
  return {
    AND: [clientRequestScopeWhere(session), { status: { in: ['submitted', 'in_triage'] } }],
  };
}

export function intakeEnrollmentWhere(): Prisma.EnrollmentRequestWhereInput {
  // Reviewer-очередь team-wide (зеркало enrollments scopeWhere для staff).
  return { status: 'pending' };
}

export function intakeInboundWhere(session: SessionPayload): Prisma.InboundMessageWhereInput {
  return { AND: [inboxScopeWhere(session), { status: 'unresolved' }] };
}

export async function listIntake(
  prisma: PrismaClient,
  session: SessionPayload,
  filters: IntakeFilters = {}
): Promise<{ ok: true; result: IntakeResult } | { ok: false; error: 'forbidden' }> {
  if (!canTriageClientRequests(session)) return { ok: false, error: 'forbidden' };

  // PR-3 (§4.4): пороги подсветки — настройка компании (фолбэк на константы).
  const thresholds = session.companyId
    ? await prisma.company.findUnique({
        where: { id: session.companyId },
        select: { slaResponseHours: true, slaWarningHours: true },
      })
    : null;
  const warningHours = thresholds?.slaWarningHours ?? INTAKE_WARNING_HOURS;
  const breachHours = thresholds?.slaResponseHours ?? INTAKE_BREACH_HOURS;

  const now = Date.now();
  const [requests, enrollments, inbound, calls] = await Promise.all([
    prisma.clientRequest.findMany({
      where: intakeClientRequestWhere(session),
      orderBy: { createdAt: 'asc' },
      take: SOURCE_CAP,
      select: {
        id: true,
        createdAt: true,
        companyName: true,
        subject: true,
        status: true,
        triagedByUserId: true,
        organizationId: true,
      },
    }),
    prisma.enrollmentRequest.findMany({
      where: intakeEnrollmentWhere(),
      orderBy: { createdAt: 'asc' },
      take: SOURCE_CAP,
      select: {
        id: true,
        createdAt: true,
        claimedByUserId: true,
        organizationId: true,
        legacyCourseTitle: true,
        organization: { select: { name: true } },
        partner: { select: { name: true } },
        // `У-36`: направление живёт в позициях — берём его оттуда.
        items: { select: { id: true, direction: { select: { name: true } } }, take: 100 },
      },
    }),
    prisma.inboundMessage.findMany({
      where: intakeInboundWhere(session),
      orderBy: { createdAt: 'asc' },
      take: SOURCE_CAP,
      select: {
        id: true,
        createdAt: true,
        channel: true,
        senderDisplay: true,
        senderRef: true,
        subject: true,
        body: true,
        claimedByUserId: true,
        resolvedOrgId: true,
      },
    }),
    prisma.call.findMany({
      where: intakeCallWhere(session),
      orderBy: { createdAt: 'asc' },
      take: SOURCE_CAP,
      select: {
        id: true,
        createdAt: true,
        callerNumber: true,
        durationSec: true,
        status: true,
        claimedByUserId: true,
      },
    }),
  ]);

  const items: IntakeItem[] = [];

  for (const r of requests) {
    items.push({
      type: 'client_request',
      id: r.id,
      from: r.companyName,
      essence: r.subject,
      createdAt: r.createdAt,
      waitingMs: now - r.createdAt.getTime(),
      slaLevel: 'ok',
      responsibleUserId: r.status === 'in_triage' ? r.triagedByUserId : null,
      responsibleName: null,
      href: '/requests',
      leadPrefill: null,
      taskTitle: `Обращение клиента: ${r.subject}`,
      organizationId: r.organizationId,
    });
  }

  for (const e of enrollments) {
    // `У-36`: направление берётся из позиций (шапочного поля больше нет);
    // текстовый курс старых заявок остаётся резервом.
    const direction =
      e.items.find((i) => i.direction?.name)?.direction?.name ??
      e.legacyCourseTitle ??
      'Заявка на обучение';
    items.push({
      type: 'enrollment',
      id: e.id,
      from: e.organization?.name ?? e.partner?.name ?? '—',
      essence: `${direction} · слушателей: ${e.items.length}`,
      createdAt: e.createdAt,
      waitingMs: now - e.createdAt.getTime(),
      slaLevel: 'ok',
      responsibleUserId: e.claimedByUserId,
      responsibleName: null,
      href: '/enrollments',
      leadPrefill: null,
      taskTitle: `Заявка на обучение: ${direction}`,
      organizationId: e.organizationId,
    });
  }

  const CHANNEL_LABEL: Record<string, string> = {
    email: 'письмо',
    telegram: 'Telegram',
    max: 'Max',
    whatsapp: 'WhatsApp',
    cabinet: 'вопрос из кабинета',
  };
  for (const m of inbound) {
    const from = m.senderDisplay?.trim() || m.senderRef;
    const essence = m.subject?.trim() || m.body.slice(0, 120);
    items.push({
      type: 'inbound',
      id: m.id,
      from,
      essence: `${CHANNEL_LABEL[m.channel] ?? m.channel}: ${essence}`,
      createdAt: m.createdAt,
      waitingMs: now - m.createdAt.getTime(),
      slaLevel: 'ok',
      responsibleUserId: m.claimedByUserId,
      responsibleName: null,
      href: '/inbox',
      leadPrefill: {
        companyName: from,
        contactName: from,
        contactPhone: '',
        contactEmail: m.channel === 'email' ? m.senderRef : '',
        subject: m.subject?.trim() || 'Обращение из внешнего канала',
      },
      taskTitle: `Обращение: ${essence}`,
      organizationId: m.resolvedOrgId,
    });
  }

  for (const c of calls) {
    items.push({
      type: 'call',
      id: c.id,
      from: c.callerNumber,
      essence:
        c.durationSec != null
          ? `Входящий звонок · ${c.durationSec} сек`
          : `Входящий звонок · ${c.status}`,
      createdAt: c.createdAt,
      waitingMs: now - c.createdAt.getTime(),
      slaLevel: 'ok',
      responsibleUserId: c.claimedByUserId,
      responsibleName: null,
      href: '/calls',
      leadPrefill: {
        companyName: '',
        contactName: c.callerNumber,
        contactPhone: c.callerNumber,
        contactEmail: '',
        subject: 'Входящий звонок',
      },
      taskTitle: `Перезвонить: ${c.callerNumber}`,
      organizationId: null,
    });
  }

  // Имена ответственных — одним запросом.
  const responsibleIds = [
    ...new Set(items.map((i) => i.responsibleUserId).filter((v): v is string => !!v)),
  ];
  if (responsibleIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: responsibleIds } },
      select: { id: true, name: true },
    });
    const byId = new Map(users.map((u) => [u.id, u.name]));
    for (const item of items) {
      if (item.responsibleUserId) item.responsibleName = byId.get(item.responsibleUserId) ?? null;
    }
  }

  for (const item of items) item.slaLevel = slaLevelFor(item.waitingMs, warningHours, breachHours);

  let filtered = items;
  if (filters.onlyUnassigned) filtered = filtered.filter((i) => !i.responsibleUserId);
  else if (filters.assigneeId)
    filtered = filtered.filter((i) => i.responsibleUserId === filters.assigneeId);

  filtered.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  // ПДн: контакты обращений/звонков в списке (НФ-2) — только реально показанные строки.
  await recordPiiAccess(prisma, {
    session,
    context: 'intake_list',
    subjectIds: paged.filter((i) => i.type === 'inbound' || i.type === 'call').map((i) => i.id),
  });

  return { ok: true, result: { items: paged, total: filtered.length } };
}

/** Счётчик для бейджа меню (ФТ-8.4) — те же критерии, только count'ы. */
export async function countIntake(prisma: PrismaClient, session: SessionPayload): Promise<number> {
  if (!canTriageClientRequests(session)) return 0;
  const [a, b, c, d] = await Promise.all([
    prisma.clientRequest.count({ where: intakeClientRequestWhere(session) }),
    prisma.enrollmentRequest.count({ where: intakeEnrollmentWhere() }),
    prisma.inboundMessage.count({ where: intakeInboundWhere(session) }),
    prisma.call.count({ where: intakeCallWhere(session) }),
  ]);
  return a + b + c + d;
}
