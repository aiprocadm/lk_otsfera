import type { PrismaClient, ServiceType } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isManagerLeader, isStaffManagerSide } from '@/lib/auth/roleModel';
import { managerOrgScope, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';
import { getInitialStatusId } from '@/lib/services/orderStatuses/definitions';

/**
 * «Создать заказ» без лида (этап 6 ТЗ 13.10.2026, `У-306`, `Р-6-5`).
 *
 * Клиент сразу готов работать — заводить лид ради формальности незачем.
 * Заказ получает начальный статус справочника («Черновик заявки»),
 * ответственный — создавший сотрудник. Организация — только из охвата
 * сотрудника (`managerOrgScope`, тот же, что у списка организаций): чужая
 * неотличима от несуществующей.
 */

export type CreateOrderError = 'forbidden' | 'not_found' | 'validation';

const TITLE_MAX = 200;

export async function createOrderDirect(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { organizationId: string; title: string; serviceType: ServiceType }
): Promise<{ ok: true; orderId: string } | { ok: false; error: CreateOrderError }> {
  if (!isStaffManagerSide(session) || !session.companyId) return { ok: false, error: 'forbidden' };
  const title = args.title.trim();
  if (!title || title.length > TITLE_MAX) return { ok: false, error: 'validation' };

  // `У-335`: руководитель работает по всей компании (как его список заказов и
  // организаций — `teamModeOverride`), рядовой менеджер — по настройке компании.
  // Без этого руководитель выбирал клиента из списка всей компании, а сервер
  // при выключенном режиме команды отвечал «не найдено».
  const teamMode =
    isManagerLeader(session) || (await getCompanyTeamVisibility(prisma, session.companyId));
  const org = await prisma.organization.findFirst({
    where: { AND: [managerOrgScope(session, teamMode), { id: args.organizationId }] },
    select: { id: true, companyId: true, partnerId: true },
  });
  // Организация без компании или чужой компании — заказ ей не заводим (C8).
  if (!org || org.companyId !== session.companyId) return { ok: false, error: 'not_found' };

  const order = await prisma.$transaction(async (tx) => {
    const statusId = await getInitialStatusId(tx);
    return tx.order.create({
      data: {
        statusId,
        title,
        companyId: session.companyId as string,
        organizationId: org.id,
        partnerId: org.partnerId,
        managerId: session.sub,
        serviceType: args.serviceType,
        executionStatus: 'pending',
        financialStatus: 'not_billed',
      },
      select: { id: true },
    });
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_created_directly',
    entity: 'order',
    entityId: order.id,
    after: { organizationId: org.id, serviceType: args.serviceType },
  });
  return { ok: true, orderId: order.id };
}
