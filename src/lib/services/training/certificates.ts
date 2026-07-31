import type { PrismaClient, Prisma, Certificate } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managedOrgIds, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';
import { recordPiiAccess } from '@/lib/pii/record';

export type CertificatesError = 'forbidden' | 'not_found' | 'validation';
type Result<T> = ({ ok: true } & T) | { ok: false; error: CertificatesError };

const CERT_INCLUDE = {
  student: { select: { id: true, name: true } },
  direction: { select: { id: true, name: true } },
  // Этап 3: колонка «Организация» в реестре партнёра.
  organization: { select: { id: true, name: true } },
} satisfies Prisma.CertificateInclude;

export type CertificateRow = Prisma.CertificateGetPayload<{ include: typeof CERT_INCLUDE }>;

function canEditCertificates(session: SessionPayload): boolean {
  return session.role === 'admin' || session.role === 'manager';
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

  if (session.role === 'manager') {
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

export type CertificateStatusFilter = 'active' | 'expiring' | 'expired';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LIST_MAX_TAKE = 200;

/**
 * Статус одного удостоверения (спека этапа 3 §4): считается от начала дня
 * `today`. Единый источник для бейджа реестра и xlsx-экспорта (PR-2).
 */
export function certificateStatus(validUntil: Date | null, today: Date): CertificateStatusFilter {
  if (!validUntil) return 'active';
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.ceil((validUntil.getTime() - startOfToday.getTime()) / MS_PER_DAY);
  if (days < 0) return 'expired';
  if (days <= EXPIRING_WITHIN_DAYS) return 'expiring';
  return 'active';
}

/**
 * SQL-границы статуса по `validUntil` (спека этапа 3 §4): статус не хранится,
 * считается от начала текущего дня. `active` включает бессрочные (null).
 */
function statusWhere(status: CertificateStatusFilter, now: Date): Prisma.CertificateWhereInput {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const horizon = new Date(startOfToday.getTime() + EXPIRING_WITHIN_DAYS * MS_PER_DAY);
  if (status === 'expired') return { validUntil: { not: null, lt: startOfToday } };
  if (status === 'expiring') return { validUntil: { gte: startOfToday, lte: horizon } };
  return { OR: [{ validUntil: null }, { validUntil: { gt: horizon } }] };
}

export type ListCertificatesArgs = {
  studentId?: string;
  expiringWithinDays?: number;
  /** Этап 3: сузить до одной организации (активная организация кабинета).
   *  Пересекается со скоупом сессии — чужой id даёт пустую выдачу. */
  organizationId?: string;
  directionId?: string;
  status?: CertificateStatusFilter;
  /** Поиск по ФИО сотрудника (insensitive contains). */
  search?: string;
  take?: number;
  skip?: number;
  /** Инъекция «сегодня» для детерминированных тестов границ статуса. */
  now?: Date;
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
    const until = new Date(Date.now() + args.expiringWithinDays * MS_PER_DAY);
    where.validUntil = { not: null, lte: until };
  } else if (args.status) {
    Object.assign(where, statusWhere(args.status, args.now ?? new Date()));
  }
  if (args.search?.trim()) {
    where.student = { name: { contains: args.search.trim(), mode: 'insensitive' } };
  }

  const paginated = args.take != null;
  const take = paginated ? Math.min(Math.max(1, Math.floor(args.take!)), LIST_MAX_TAKE) : undefined;
  const skip = paginated ? Math.max(0, Math.floor(args.skip ?? 0)) : undefined;

  const [certificates, total] = await Promise.all([
    prisma.certificate.findMany({
      where,
      include: CERT_INCLUDE,
      orderBy: { issuedAt: 'desc' },
      ...(paginated ? { take, skip } : {}),
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

  const certificate = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'certificate_issued',
    entity: 'certificate',
    entityId: certificate.id,
    after: { orderItemId: item.id, number: certificate.number },
  });

  return { ok: true, certificate };
}
