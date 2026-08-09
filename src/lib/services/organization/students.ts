import type { PrismaClient } from '@prisma/client';

export type OrgStudentRow = {
  id: string;
  name: string;
  /** У-21 (этап 5): почта у сотрудника необязательна — рабочих обучают без неё. */
  email: string | null;
  externalStudentId: string | null;
  createdAt: Date;
};

/** Строка выгрузки сотрудников (ФТ-12.2): + должность и счётчик удостоверений. */
export type OrgStudentExportRow = OrgStudentRow & {
  position: string | null;
  activeCertificates: number;
};

// Фильтры списка: «ключа нет» и «ключ = undefined» — одно и то же (не фильтровать).
export type ListOrgStudentsOptions = {
  organizationId: string;
  search?: string | undefined;
  take?: number | undefined;
  skip?: number | undefined;
};

export type ListOrgStudentsResult = {
  rows: OrgStudentRow[];
  total: number;
};

const DEFAULT_TAKE = 50;
const MAX_TAKE = 200;

function normalizeTake(take: number | undefined): number {
  if (take === undefined) return DEFAULT_TAKE;
  if (!Number.isFinite(take) || take <= 0) return DEFAULT_TAKE;
  return Math.min(Math.floor(take), MAX_TAKE);
}

function normalizeSkip(skip: number | undefined): number {
  if (skip === undefined) return 0;
  if (!Number.isFinite(skip) || skip < 0) return 0;
  return Math.floor(skip);
}

/** Фильтр списка сотрудников — общий для экрана и выгрузки (ФТ-12.1). */
function orgStudentsWhere(opts: { organizationId: string; search?: string | undefined }) {
  return {
    organizationId: opts.organizationId,
    ...(opts.search
      ? {
          OR: [
            { name: { contains: opts.search, mode: 'insensitive' as const } },
            { email: { contains: opts.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
}

export async function listOrgStudents(
  prisma: PrismaClient,
  opts: ListOrgStudentsOptions
): Promise<ListOrgStudentsResult> {
  const take = normalizeTake(opts.take);
  const skip = normalizeSkip(opts.skip);

  const where = orgStudentsWhere(opts);

  const [total, students] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take,
      skip,
      select: {
        id: true,
        name: true,
        email: true,
        externalStudentId: true,
        createdAt: true,
      },
    }),
  ]);

  return { rows: students, total };
}

/**
 * Выгрузка сотрудников организации (этап 9 PR-3, ФТ-12.2): тот же фильтр, что
 * у экрана, + должность и счётчик **действующих** удостоверений на дату
 * выгрузки. «Действующее» = бессрочное (`validUntil = null`) или срок не истёк
 * — та же граница, что у `certificateStatus` (истёкшие не считаем).
 */
export async function listOrgStudentsForExport(
  prisma: PrismaClient,
  // Фильтры выгрузки: «ключа нет» и «ключ = undefined» — одно и то же.
  opts: {
    organizationId: string;
    search?: string | undefined;
    limit: number;
    now?: Date | undefined;
  }
): Promise<{ rows: OrgStudentExportRow[]; total: number }> {
  const where = orgStudentsWhere(opts);
  const startOfToday = new Date(opts.now ?? new Date());
  startOfToday.setHours(0, 0, 0, 0);

  const [total, students] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: opts.limit,
      select: {
        id: true,
        name: true,
        email: true,
        position: true,
        externalStudentId: true,
        createdAt: true,
      },
    }),
  ]);

  const studentIds = students.map((s) => s.id);
  const counts = studentIds.length
    ? await prisma.certificate.groupBy({
        by: ['studentId'],
        where: {
          studentId: { in: studentIds },
          OR: [{ validUntil: null }, { validUntil: { gte: startOfToday } }],
        },
        _count: { _all: true },
      })
    : [];
  const countByStudent = new Map(counts.map((c) => [c.studentId, c._count._all]));

  return {
    rows: students.map((s) => ({ ...s, activeCertificates: countByStudent.get(s.id) ?? 0 })),
    total,
  };
}

export type OrgStudentCard = {
  id: string;
  name: string;
  email: string | null;
  position: string | null;
  externalStudentId: string | null;
  createdAt: Date;
};

/**
 * Карточка сотрудника (этап 3, ФТ-6.3). Скоуп — организация из аргумента
 * (активная организация кабинета): чужой/несуществующий id = null (страница
 * отвечает notFound; чужой сотрудник неотличим от несуществующего).
 */
export async function getOrgStudent(
  prisma: PrismaClient,
  args: { organizationId: string; studentId: string }
): Promise<OrgStudentCard | null> {
  return prisma.student.findFirst({
    where: { id: args.studentId, organizationId: args.organizationId },
    select: {
      id: true,
      name: true,
      email: true,
      position: true,
      externalStudentId: true,
      createdAt: true,
    },
  });
}

/**
 * Правка должности сотрудника (этап 9 PR-3, ФТ-12.2). Скоуп — активная
 * организация кабинета: чужой сотрудник = `forbidden` (как и несуществующий —
 * существование чужой записи не подтверждаем). Пустая строка очищает поле:
 * должность необязательна (решение заказчика §9-1 спеки).
 */
export async function updateOrgStudentPosition(
  prisma: PrismaClient,
  args: { organizationId: string; studentId: string; position: string }
): Promise<
  { ok: true; position: string | null } | { ok: false; error: 'forbidden' | 'validation' }
> {
  const position = args.position.trim();
  if (position.length > 200) return { ok: false, error: 'validation' };

  const student = await prisma.student.findFirst({
    where: { id: args.studentId, organizationId: args.organizationId },
    select: { id: true },
  });
  if (!student) return { ok: false, error: 'forbidden' };

  const next = position || null;
  await prisma.student.update({ where: { id: student.id }, data: { position: next } });
  return { ok: true, position: next };
}

export type OrgStudentTrainingRow = {
  id: string;
  trainingStatus: 'pending' | 'in_progress' | 'certificate_issued' | 'cancelled';
  createdAt: Date;
  direction: { name: string };
  order: { id: string; title: string; orderNumber: string | null };
};

/**
 * История обучения сотрудника (ФТ-6.3): позиции заказов его организации.
 * Скоуп по организации заказа — позиции чужих организаций (сотрудник когда-то
 * переносился) не показываются.
 */
export async function listOrgStudentTraining(
  prisma: PrismaClient,
  args: { organizationId: string; studentId: string }
): Promise<OrgStudentTrainingRow[]> {
  return prisma.orderItem.findMany({
    where: { studentId: args.studentId, order: { organizationId: args.organizationId } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      trainingStatus: true,
      createdAt: true,
      direction: { select: { name: true } },
      order: { select: { id: true, title: true, orderNumber: true } },
    },
  });
}
