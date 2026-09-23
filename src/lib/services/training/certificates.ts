import type { PrismaClient, Prisma, Certificate } from '@prisma/client';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managedOrgIds, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';
import { recordPiiAccess } from '@/lib/pii/record';
import {
  dueByWhere,
  dueWithinDaysWhere,
  isPastDue,
  moscowDaysUntil,
  pastDueWhere,
} from '@/lib/tasks/due';
import { isUniqueViolationOn } from '@/lib/db/uniqueViolation';

type CertificatesError = 'forbidden' | 'not_found' | 'validation' | 'already_issued';
type Result<T> = ({ ok: true } & T) | { ok: false; error: CertificatesError };

const CERT_INCLUDE = {
  student: { select: { id: true, name: true } },
  direction: { select: { id: true, name: true } },
  // Этап 3: колонка «Организация» в реестре партнёра.
  organization: { select: { id: true, name: true } },
} satisfies Prisma.CertificateInclude;

export type CertificateRow = Prisma.CertificateGetPayload<{ include: typeof CERT_INCLUDE }>;

function canEditCertificates(session: SessionPayload): boolean {
  return session.role === 'admin' || isStaffManagerSide(session);
}

/**
 * Множество organizationId, видимых сессии.
 * null = «все» (admin); массив id для scoped-ролей.
 */
async function scopeOrgIds(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<string[] | null> {
  if (session.role === 'admin') return null;

  if (isStaffManagerSide(session)) {
    const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
    if (teamMode && session.companyId) {
      const orgs = await prisma.organization.findMany({
        where: { companyId: session.companyId },
        select: { id: true },
      });
      return orgs.map((o) => o.id);
    }
    return managedOrgIds(session);
  }

  if (session.role === 'partner') {
    const orgs = await prisma.organization.findMany({
      where: { partnerId: session.partnerId ?? '__none__' },
      select: { id: true },
    });
    const ids = orgs.map((o) => o.id);
    // Этап 3 (ФТ-6.2): partner-manager видит только закреплённые организации —
    // пересечение организаций партнёра с assignedOrgIds сессии.
    if (session.partnerRole === 'manager') {
      const assigned = new Set(session.assignedOrgIds ?? []);
      return ids.filter((id) => assigned.has(id));
    }
    return ids;
  }

  if (session.role === 'organization') {
    // OrganizationMembership[] — массив { organizationId, roleInOrg, isActive }
    return (session.organizationMemberships ?? [])
      .filter((m) => m.isActive)
      .map((m) => m.organizationId);
  }

  return [];
}

/** Порог «истекает» реестра (ФТ-6.1, ≤ 60 дней — фиксирован в ТЗ). */
export const EXPIRING_WITHIN_DAYS = 60;

/** Единый источник фильтров статуса реестра (дедупликация C2, фаза 2). */
export const CERTIFICATE_STATUS_FILTERS = ['active', 'expiring', 'expired'] as const;

export type CertificateStatusFilter = (typeof CERTIFICATE_STATUS_FILTERS)[number];

const LIST_MAX_TAKE = 200;

/**
 * Статус одного удостоверения (спека этапа 3 §4) по московским дням. Единый
 * источник для бейджа реестра и xlsx-экспорта (PR-2).
 *
 * Прогон №36 (`Р-М-3`): считаем через общее правило сроков `lib/tasks/due.ts`
 * — ту же границу, что и у {@link statusWhere}. Прежний `Math.ceil` от
 * московской полуночи давал удостоверению со сроком «вчера» `-0` дней, и
 * `-0 < 0` ложно: фильтр «Истекло» его показывал, а значок в той же строке
 * писал «Истекает через 0 дн.». Порог «≤ 60 дней» заодно вернулся к 60-му дню
 * включительно (с прежней формулой выходило 59).
 */
export function certificateStatus(validUntil: Date | null, today: Date): CertificateStatusFilter {
  if (!validUntil) return 'active';
  if (isPastDue(validUntil, today)) return 'expired';
  if (moscowDaysUntil(validUntil, today) <= EXPIRING_WITHIN_DAYS) return 'expiring';
  return 'active';
}

/**
 * SQL-границы статуса по `validUntil` (спека этапа 3 §4): статус не хранится,
 * считается от начала текущего московского дня. `active` включает бессрочные
 * (null). Три условия стыкуются без зазора: «истекает» начинается ровно там,
 * где кончается «истекло», а «действует» — там, где кончается «истекает».
 */
function statusWhere(status: CertificateStatusFilter, now: Date): Prisma.CertificateWhereInput {
  const expiring = dueWithinDaysWhere(now, EXPIRING_WITHIN_DAYS);
  if (status === 'expired') return { validUntil: { not: null, ...pastDueWhere(now) } };
  if (status === 'expiring') return { validUntil: expiring };
  return { OR: [{ validUntil: null }, { validUntil: { gte: expiring.lt } }] };
}

// Фильтры списка: «ключа нет» и «ключ = undefined» — одно и то же (не фильтровать).
export type ListCertificatesArgs = {
  studentId?: string | undefined;
  expiringWithinDays?: number | undefined;
  /** Этап 3: сузить до одной организации (активная организация кабинета).
   *  Пересекается со скоупом сессии — чужой id даёт пустую выдачу. */
  organizationId?: string | undefined;
  directionId?: string | undefined;
  status?: CertificateStatusFilter | undefined;
  /** Поиск по ФИО сотрудника (insensitive contains). */
  search?: string | undefined;
  take?: number | undefined;
  skip?: number | undefined;
  /** Инъекция «сегодня» для детерминированных тестов границ статуса. */
  now?: Date | undefined;
};

export async function listCertificates(
  prisma: PrismaClient,
  session: SessionPayload,
  args: ListCertificatesArgs
): Promise<Result<{ certificates: CertificateRow[]; total: number }>> {
  const orgIds = await scopeOrgIds(prisma, session);
  const where: Prisma.CertificateWhereInput = {};
  if (args.organizationId) {
    // Пересечение с видимым скоупом — вне скоупа выдача пустая (не forbidden:
    // чужая организация неотличима от организации без удостоверений).
    where.organizationId =
      orgIds === null
        ? args.organizationId
        : { in: orgIds.includes(args.organizationId) ? [args.organizationId] : [] };
  } else if (orgIds !== null) {
    where.organizationId = { in: orgIds };
  }
  if (args.studentId) where.studentId = args.studentId;
  if (args.directionId) where.directionId = args.directionId;
  if (args.expiringWithinDays != null) {
    // Прежний фильтр «истекает в ближайшие N дней» (вместе с истёкшими) — тоже
    // по московским дням (прогон №36): «через N суток от этой секунды» резал
    // последний день окна по времени запроса.
    where.validUntil = {
      not: null,
      ...dueByWhere(args.now ?? new Date(), args.expiringWithinDays),
    };
  } else if (args.status) {
    Object.assign(where, statusWhere(args.status, args.now ?? new Date()));
  }
  if (args.search?.trim()) {
    where.student = { name: { contains: args.search.trim(), mode: 'insensitive' } };
  }

  // Без args.take ключи take/skip не попадают в аргументы Prisma вовсе —
  // выборка без пагинации (прежнее поведение `take: undefined`).
  const pagination: { take?: number; skip?: number } =
    args.take != null
      ? {
          take: Math.min(Math.max(1, Math.floor(args.take)), LIST_MAX_TAKE),
          skip: Math.max(0, Math.floor(args.skip ?? 0)),
        }
      : {};

  const [certificates, total] = await Promise.all([
    prisma.certificate.findMany({
      where,
      include: CERT_INCLUDE,
      // Хвост `id` обязателен: `issuedAt` — дата выдачи, у пачки удостоверений
      // одного заказа она одна и та же, а PostgreSQL при равных ключах порядок
      // не обещает и на разных страницах выдаёт разный (top-N heapsort зависит
      // от LIMIT/OFFSET). Без хвоста одно удостоверение показывалось на двух
      // страницах, а другое не показывалось вовсе.
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      ...pagination,
    }),
    prisma.certificate.count({ where }),
  ]);
  await recordPiiAccess(prisma, {
    session,
    context: 'certificates_list',
    subjectIds: certificates.map((c) => c.studentId),
  });
  return { ok: true, certificates, total };
}

async function assertStudentInScope(
  prisma: PrismaClient,
  session: SessionPayload,
  studentId: string
): Promise<{ organizationId: string } | null> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { organizationId: true },
  });
  if (!student) return null;
  const orgIds = await scopeOrgIds(prisma, session);
  if (orgIds !== null && !orgIds.includes(student.organizationId)) return null;
  return student;
}

export async function createCertificate(
  prisma: PrismaClient,
  session: SessionPayload,
  args: {
    studentId: string;
    directionId: string;
    number: string;
    issuedAt: Date;
    validUntil?: Date | null;
    orderItemId?: string | null;
    documentId?: string | null;
    comment?: string | null;
  }
): Promise<Result<{ certificate: Certificate }>> {
  if (!canEditCertificates(session)) return { ok: false, error: 'forbidden' };
  if (!args.number?.trim()) return { ok: false, error: 'validation' };

  const student = await assertStudentInScope(prisma, session, args.studentId);
  if (!student) return { ok: false, error: 'forbidden' };

  let certificate: Certificate;
  try {
    certificate = await prisma.certificate.create({
      data: {
        studentId: args.studentId,
        organizationId: student.organizationId,
        directionId: args.directionId,
        number: args.number.trim(),
        issuedAt: args.issuedAt,
        validUntil: args.validUntil ?? null,
        orderItemId: args.orderItemId ?? null,
        documentId: args.documentId ?? null,
        comment: args.comment?.trim() || null,
      },
    });
  } catch (e) {
    // P2003 = FK violation (unknown directionId/studentId) → not_found per Result contract.
    if ((e as { code?: string }).code === 'P2003') return { ok: false, error: 'not_found' };
    throw e;
  }

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'certificate_created',
    entity: 'certificate',
    entityId: certificate.id,
    after: { studentId: args.studentId, number: certificate.number },
  });

  return { ok: true, certificate };
}

export async function issueFromOrderItem(
  prisma: PrismaClient,
  session: SessionPayload,
  args: {
    orderItemId: string;
    number: string;
    issuedAt: Date;
    validUntil?: Date | null;
    documentId?: string | null;
  }
): Promise<Result<{ certificate: Certificate }>> {
  if (!canEditCertificates(session)) return { ok: false, error: 'forbidden' };
  if (!args.number?.trim()) return { ok: false, error: 'validation' };

  const item = await prisma.orderItem.findUnique({
    where: { id: args.orderItemId },
    select: {
      id: true,
      directionId: true,
      student: { select: { id: true, organizationId: true } },
    },
  });
  if (!item) return { ok: false, error: 'not_found' };

  const orgIds = await scopeOrgIds(prisma, session);
  if (orgIds !== null && !orgIds.includes(item.student.organizationId)) {
    return { ok: false, error: 'forbidden' };
  }

  // По позиции заказа удостоверение одно: `Certificate.orderItemId` уникален.
  // Проверка ниже — ради текста («уже выдано»), а гонку и повторный запрос с
  // устаревшей страницы ловит уже база — разбор `P2002` ниже (хотфикс №40).
  const already = await prisma.certificate.findUnique({
    where: { orderItemId: item.id },
    select: { id: true },
  });
  if (already) return { ok: false, error: 'already_issued' };

  let certificate: Certificate;
  try {
    certificate = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const cert = await tx.certificate.create({
        data: {
          studentId: item.student.id,
          organizationId: item.student.organizationId,
          directionId: item.directionId,
          orderItemId: item.id,
          number: args.number.trim(),
          issuedAt: args.issuedAt,
          validUntil: args.validUntil ?? null,
          documentId: args.documentId ?? null,
        },
      });
      await tx.orderItem.update({
        where: { id: item.id },
        data: { trainingStatus: 'certificate_issued' },
      });
      return cert;
    });
  } catch (e) {
    if (isUniqueViolationOn(e, 'orderItemId')) return { ok: false, error: 'already_issued' };
    throw e;
  }

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'certificate_issued',
    entity: 'certificate',
    entityId: certificate.id,
    after: { orderItemId: item.id, number: certificate.number },
  });

  return { ok: true, certificate };
}
