import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrgScope } from '@/lib/auth/managerPolicy';
import { isManagerLeader } from '@/lib/auth/roleModel';

export type ContactOrgOption = { id: string; name: string };

const OPTIONS_CAP = 500;

/**
 * Организации, к которым сотрудник может привязать контакт (`У-180`): те же,
 * что видит его справочник — иначе форма предложит организацию, а сервис
 * ответит «не найдено». Администратор и руководитель без профиля — вся
 * компания; менеджер — по команде или закреплениям.
 */
export async function listContactOrgOptions(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean
): Promise<ContactOrgOption[]> {
  if (!session.companyId) return [];
  // Компания доказана проверкой выше — страховочный sentinel здесь был бы мёртвой веткой.
  const floor: Prisma.OrganizationWhereInput = { companyId: session.companyId };
  const where =
    session.role === 'admin' || (isManagerLeader(session) && !session.accessProfile)
      ? floor
      : { AND: [floor, managerOrgScope(session, teamMode)] };
  return prisma.organization.findMany({
    where,
    select: { id: true, name: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: OPTIONS_CAP,
  });
}
