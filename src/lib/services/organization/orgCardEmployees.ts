import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { studentOrgAccess } from '@/lib/services/students/access';
import { recordPiiAccess } from '@/lib/pii/record';

/**
 * Сотрудники организации для вкладки «Сотрудники» карточки (`У-97`).
 *
 * Один сервис на все кабинеты: список показывает **сотрудников организации**
 * (`Student`) — тех самых людей, которых заводит кнопка «Добавить сотрудника».
 * До этапа 2 у партнёра вкладка читала `OrganizationUser` (пользователей
 * кабинета), и добавленный сотрудник в ней не появлялся никогда (`Д-27`).
 *
 * Права — общая политика `studentOrgAccess` (§4: граница в сервисе, а не в
 * компоненте). `canWrite` возвращается наружу, чтобы экран знал, показывать ли
 * кнопку добавления, но запрет всё равно живёт в сервисе создания.
 */
export type OrgCardEmployeeRow = {
  id: string;
  name: string;
  email: string | null;
  position: string | null;
  status: string;
  createdAt: Date;
};

export type OrgCardEmployeesResult = {
  rows: OrgCardEmployeeRow[];
  total: number;
  canWrite: boolean;
};

export const ORG_CARD_EMPLOYEES_PAGE_SIZE = 25;

export async function listOrgCardEmployees(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orgId: string; q?: string; includeInactive?: boolean; take?: number; skip?: number }
): Promise<OrgCardEmployeesResult> {
  // Менеджерский скоуп mode-aware (C8): флаг читается свежим, а не из сессии.
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const access = await studentOrgAccess(prisma, session, args.orgId, teamMode);
  if (!access.canRead) return { rows: [], total: 0, canWrite: false };

  const q = args.q?.trim();
  const where: Prisma.StudentWhereInput = {
    organizationId: args.orgId,
    ...(args.includeInactive ? {} : { status: 'active' }),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const take = Math.min(Math.max(args.take ?? ORG_CARD_EMPLOYEES_PAGE_SIZE, 1), 100);
  const skip = Math.max(args.skip ?? 0, 0);

  const [rows, total] = await Promise.all([
    prisma.student.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      take,
      skip,
      select: {
        id: true,
        name: true,
        email: true,
        position: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.student.count({ where }),
  ]);

  return { rows, total, canWrite: access.canWrite };
}


/**
 * Карточка одного сотрудника **внутри карточки организации** (`У-97`).
 *
 * Организация в адресе — не украшение, а граница: сотрудник ищется
 * `{ id, organizationId }` вместе. Подставить чужой `studentId` в свой адрес
 * не выйдет — вернётся `null`, и страница ответит «не найдено», не
 * подтверждая существование чужого человека.
 *
 * Выдача карточки журналируется (§25.7): здесь видны СНИЛС, дата рождения и
 * телефон — это персональные данные физлица клиентского контура. Хелпер сам
 * отсеивает клиентские роли, поэтому запись появляется только для сотрудников
 * учебного центра.
 */
export type OrgCardEmployeeDetail = {
  id: string;
  name: string;
  email: string | null;
  position: string | null;
  snils: string | null;
  birthDate: Date | null;
  phone: string | null;
  note: string | null;
  status: string;
  createdAt: Date;
};

export async function getOrgCardEmployee(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orgId: string; studentId: string }
): Promise<OrgCardEmployeeDetail | null> {
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const access = await studentOrgAccess(prisma, session, args.orgId, teamMode);
  if (!access.canRead) return null;

  const student = await prisma.student.findFirst({
    where: { id: args.studentId, organizationId: args.orgId },
    select: {
      id: true,
      name: true,
      email: true,
      position: true,
      snils: true,
      birthDate: true,
      phone: true,
      note: true,
      status: true,
      createdAt: true,
    },
  });
  if (!student) return null;

  await recordPiiAccess(prisma, {
    session,
    context: 'org_card_employee_view',
    subjectIds: [student.id],
  });
  return student;
}
