import type { PrismaClient } from '@prisma/client';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeOrder, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { listMissingRequisites } from '@/lib/documents/requisites-check';
import { notifyOrgUsers } from '@/lib/notifications';
import { recordAudit } from '@/lib/auth/audit';
import { log } from '@/lib/logging';

export type RequestRequisitesServiceResult =
  | { ok: true }
  | { ok: false; error: 'not_found' }
  /** `У-157`: повторный запрос той же организации — не чаще раза в сутки. */
  | { ok: false; error: 'requested_recently'; requestedAt: Date };

/** Сколько ждать до повторного запроса реквизитов у той же организации. */
const REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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

  // `У-157` (дефект `Д-12`): запрос уходит письмом клиенту. Без ограничения
  // кнопку можно было нажимать без конца, и заказчик получал десяток
  // одинаковых писем за минуту. Считаем по журналу: отдельного поля под
  // «когда просили» заводить не нужно — событие уже пишется.
  const lastRequest = await prisma.auditLog.findFirst({
    where: {
      action: 'requisites_requested',
      entity: 'organization',
      entityId: order.organizationId,
      createdAt: { gte: new Date(Date.now() - REQUEST_COOLDOWN_MS) },
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (lastRequest) {
    return { ok: false, error: 'requested_recently', requestedAt: lastRequest.createdAt };
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
  // Журнал пишем ДО отправки: он же служит счётчиком «раз в сутки», и запись
  // после best-effort доставки означала бы, что сбой письма снимает
  // ограничение — и клиент получит второй запрос сразу.
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'requisites_requested',
    entity: 'organization',
    entityId: order.organizationId,
    after: { orderId: order.id, missingLabels: [...labels] },
  });

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
