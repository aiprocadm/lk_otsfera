import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordPiiAccess } from '@/lib/pii/record';
import { canUseContacts, contactScopeWhere } from './scope';

export type ContactOption = {
  id: string;
  name: string;
  position: string | null;
  organizationId: string | null;
};

const OPTIONS_CAP = 500;

/**
 * Контакты для выбора в чужих формах (`У-180` «контакт из всех точек»: форма
 * сделки, «Контакт заказа» в карточке заказа). Ровно те люди, которых
 * сотрудник видит в справочнике (`contactScopeWhere`), без архива — иначе
 * форма предложит человека, а сервис ответит «не найден». С `organizationId`
 * — только контакты этой организации (карточка заказа); без — весь охват
 * (форма сделки сама сужает список по выбранной организации).
 *
 * Имена — ПДн физлиц клиентского контура: чтение регистрируется контекстом
 * `contacts_options` (§25.7), как и список кандидатов мессенджеров.
 */
export async function listContactOptions(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean,
  filters: { organizationId?: string | undefined } = {}
): Promise<ContactOption[]> {
  if (!canUseContacts(session)) return [];
  const where: Prisma.ContactWhereInput = {
    AND: [
      contactScopeWhere(session, teamMode),
      { isArchived: false },
      ...(filters.organizationId ? [{ organizationId: filters.organizationId }] : []),
    ],
  };
  const rows = await prisma.contact.findMany({
    where,
    select: { id: true, name: true, position: true, organizationId: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: OPTIONS_CAP,
  });
  if (rows.length > 0) {
    await recordPiiAccess(prisma, {
      session,
      context: 'contacts_options',
      subjectIds: rows.map((r) => r.id),
    });
  }
  return rows;
}
