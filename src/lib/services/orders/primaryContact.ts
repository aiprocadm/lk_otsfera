import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { recordPiiAccess } from '@/lib/pii/record';
import { canSeeOrder, isLeaderSameCompany } from '@/lib/auth/managerPolicy';
import { listContactOptions, type ContactOption } from '@/lib/services/contacts/options';
import { canUseContacts, isContactInScope } from '@/lib/services/contacts/scope';

/**
 * «Контакт заказа» (`Order.primaryContactId`, `У-180`, спека 04 §«карточка
 * заказа»): с кем со стороны клиента ведут этот заказ. Выбирается из контактов
 * организации заказа — человек «с улицы» или из другой организации сюда не
 * годится; заказ без организации контакта иметь не может.
 */

export type OrderContactCurrent = ContactOption & { isArchived: boolean };

export type OrderContactPanelData = {
  current: OrderContactCurrent | null;
  options: ContactOption[];
};

type OrderContactShape = {
  organizationId: string | null;
  companyId: string | null;
  primaryContactId: string | null;
};

/**
 * Данные панели для уже загруженного (и уже проверенного скоупом карточки)
 * заказа. `null` — панели нет: у сотрудника нет права на справочник либо заказ
 * чужой компании (контакты живут в границах компании, `С8`; администратор
 * чужой компании панель не видит, а не видит пустой список).
 *
 * Текущий контакт читается отдельно от вариантов: он мог уехать в архив или к
 * другой организации — человек должен видеть, кто выбран, а не «не указан» при
 * заполненном поле.
 */
export async function getOrderContactPanel(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean,
  order: OrderContactShape
): Promise<OrderContactPanelData | null> {
  if (!canUseContacts(session)) return null;
  if (order.companyId !== session.companyId) return null;

  const options = order.organizationId
    ? await listContactOptions(prisma, session, teamMode, { organizationId: order.organizationId })
    : [];

  let current: OrderContactCurrent | null = null;
  if (order.primaryContactId) {
    const inOptions = options.find((o) => o.id === order.primaryContactId);
    if (inOptions) {
      current = { ...inOptions, isArchived: false };
    } else {
      // Компания доказана выше: `session.companyId` совпадает с компанией заказа.
      const row = await prisma.contact.findFirst({
        where: { id: order.primaryContactId, companyId: order.companyId ?? '' },
        select: { id: true, name: true, position: true, organizationId: true, isArchived: true },
      });
      if (row) {
        current = row;
        await recordPiiAccess(prisma, {
          session,
          context: 'contacts_options',
          subjectIds: [row.id],
        });
      }
    }
  }
  return { current, options };
}

export type SetOrderPrimaryContactResult =
  { ok: true } | { ok: false; error: 'forbidden' | 'not_found' | 'contact_not_found' };

/**
 * Назначить или снять контакт заказа. Скоуп — как у карточки заказа
 * (`canSeeOrder` с `teamMode`, руководитель — вся компания); контакт — не в
 * архиве, в охвате сотрудника и именно из организации заказа. Смена пишется в
 * аудит (`order_primary_contact_changed`, до/после), повтор того же значения —
 * нет.
 */
export async function setOrderPrimaryContact(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean,
  args: { orderId: string; contactId: string | null }
): Promise<SetOrderPrimaryContactResult> {
  if (!canUseContacts(session)) return { ok: false, error: 'forbidden' };

  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      managerId: true,
      organizationId: true,
      companyId: true,
      primaryContactId: true,
    },
  });
  if (!order) return { ok: false, error: 'not_found' };
  // Контакты живут в границах компании — заказ чужой компании не годится даже
  // администратору (Model A даёт видеть, но привязать нечего).
  if (order.companyId !== session.companyId) return { ok: false, error: 'forbidden' };
  if (
    session.role !== 'admin' &&
    !isLeaderSameCompany(session, order.companyId) &&
    !canSeeOrder(session, order, teamMode)
  ) {
    return { ok: false, error: 'not_found' };
  }

  if (args.contactId) {
    const contact = await prisma.contact.findUnique({
      where: { id: args.contactId },
      select: { id: true, companyId: true, organizationId: true, isArchived: true },
    });
    if (
      !contact ||
      contact.isArchived ||
      !isContactInScope(session, teamMode, contact) ||
      !order.organizationId ||
      contact.organizationId !== order.organizationId
    ) {
      return { ok: false, error: 'contact_not_found' };
    }
  }

  if (order.primaryContactId === args.contactId) return { ok: true };

  await prisma.order.update({
    where: { id: order.id },
    data: { primaryContactId: args.contactId },
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_primary_contact_changed',
    entity: 'order',
    entityId: order.id,
    before: { contactId: order.primaryContactId },
    after: { contactId: args.contactId },
  });
  return { ok: true };
}
