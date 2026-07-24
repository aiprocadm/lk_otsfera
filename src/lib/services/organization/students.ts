import type { PrismaClient } from '@prisma/client';

export type OrgStudentRow = {
  id: string;
  name: string;
  email: string;
  externalStudentId: string | null;
  createdAt: Date;
};

export type ListOrgStudentsOptions = {
  organizationId: string;
  search?: string;
  take?: number;
  skip?: number;
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

export async function listOrgStudents(
  prisma: PrismaClient,
  opts: ListOrgStudentsOptions
): Promise<ListOrgStudentsResult> {
  const take = normalizeTake(opts.take);
  const skip = normalizeSkip(opts.skip);

  const where = {
    organizationId: opts.organizationId,
    ...(opts.search
      ? {
          OR: [
            { name: { contains: opts.search, mode: 'insensitive' as const } },
            { email: { contains: opts.search, mode: 'insensitive' as const } }
          ]
        }
      : {})
  };

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
        createdAt: true
      }
    })
  ]);

  return { rows: students, total };
}

export type OrgStudentCard = {
  id: string;
  name: string;
  email: string;
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
      externalStudentId: true,
      createdAt: true
    }
  });
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
      order: { select: { id: true, title: true, orderNumber: true } }
    }
  });
}
