import type { PrismaClient } from '@prisma/client';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeOrder, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { listMissingRequisites } from '@/lib/documents/requisites-check';
import { notifyOrgUsers } from '@/lib/notifications';
import { log } from '@/lib/logging';

export type RequestRequisitesServiceResult = { ok: true } | { ok: false; error: 'not_found' };

const REQ = {
  name: true,
  legalName: true,
  inn: true,
  kpp: true,
  ogrn: true,
  legalAddress: true,
  bankName: true,
  bankAccount: true,
  corrAccount: true,
  bic: true,
  signerName: true,
  signerPosition: true,
  signerBasis: true,
} as const;

/**
 * «Запросить у клиента» — уведомление организации со списком недостающих
 * реквизитов (ФТ-9.5). Скоуп менеджера — mode-aware (C8): режим видимости
 * команды читается свежим и передаётся в `canSeeOrder` как `teamMode`; заказ
 * вне охвата отвечает `not_found` (не раскрываем существование). Роль
 * вызывающего проверяет экшен.
 *
 * Клиенту показывается ТОЛЬКО его собственное недостающее (`side ===
 * 'organization'`): дыры в карточке компании-продавца — не его забота.
 * Доставка уведомления best-effort: сбой не считается ошибкой действия (§3).
 */
export async function requestRequisites(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string }
): Promise<RequestRequisitesServiceResult> {
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      title: true,
      orderNumber: true,
      companyId: true,
      organizationId: true,
      managerId: true,
    },
  });
  if (!order || !order.organizationId || !order.companyId) return { ok: false, error: 'not_found' };

  if (isStaffManagerSide(session)) {
    const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
    const visible = canSeeOrder(
      session,
      {
        managerId: order.managerId,
        organizationId: order.organizationId,
        companyId: order.companyId,
      },
      teamMode
    );
    if (!visible) return { ok: false, error: 'not_found' };
  }

  const [company, organization] = await Promise.all([
    prisma.company.findUnique({ where: { id: order.companyId }, select: REQ }),
    prisma.organization.findUnique({ where: { id: order.organizationId }, select: REQ }),
  ]);
  if (!company || !organization) return { ok: false, error: 'not_found' };

  // Спрашиваем разом всё, что нужно ЛЮБОМУ документу (`У-156`): счёт требует
  // ИНН и КПП, договор — ещё и подписанта с основанием. Просить по частям
  // значило бы дёргать клиента дважды.
  const labels = new Set<string>();
  for (const kind of ['invoice', 'contract'] as const) {
    for (const item of listMissingRequisites(company, organization, kind)) {
      if (item.side === 'organization') labels.add(item.label);
    }
  }
  try {
    await notifyOrgUsers(prisma, {
      organizationId: order.organizationId,
      type: 'requisites_requested',
      payload: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderTitle: order.title,
        missingLabels: [...labels],
      },
    });
  } catch (err) {
    // best-effort: сбой доставки не считаем ошибкой действия
    log.warn('[documents/requestRequisites] notify failed', {
      orderId: args.orderId,
      error: (err as Error).message,
    });
  }
  return { ok: true };
}
