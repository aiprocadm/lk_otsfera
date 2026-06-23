import type { PrismaClient, Prisma, Certificate } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managedOrgIds, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';

export type CertificatesError = 'forbidden' | 'not_found' | 'validation';
type Result<T> = ({ ok: true } & T) | { ok: false; error: CertificatesError };

const CERT_INCLUDE = {
  student: { select: { id: true, name: true } },
  direction: { select: { id: true, name: true } },
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
  session: SessionPayload,
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
    return orgs.map((o) => o.id);
  }

  if (session.role === 'organization') {
    // OrganizationMembership[] — массив { organizationId, roleInOrg, isActive }
    return (session.organizationMemberships ?? [])
      .filter((m) => m.isActive)
      .map((m) => m.organizationId);
  }

  return [];
}

export async function listCertificates(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { studentId?: string; expiringWithinDays?: number },
): Promise<Result<{ certificates: CertificateRow[] }>> {
  const orgIds = await scopeOrgIds(prisma, session);
  const where: Prisma.CertificateWhereInput = {};
  if (orgIds !== null) where.organizationId = { in: orgIds };
  if (args.studentId) where.studentId = args.studentId;
  if (args.expiringWithinDays != null) {
    const until = new Date(Date.now() + args.expiringWithinDays * 24 * 60 * 60 * 1000);
    where.validUntil = { not: null, lte: until };
  }
  const certificates = await prisma.certificate.findMany({
    where,
    include: CERT_INCLUDE,
    orderBy: { issuedAt: 'desc' },
  });
  return { ok: true, certificates };
}

async function assertStudentInScope(
  prisma: PrismaClient,
  session: SessionPayload,
  studentId: string,
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
  },
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
  },
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
