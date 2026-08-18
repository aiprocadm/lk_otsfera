import type { Deal, Lead, Order, PrismaClient } from '@prisma/client';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { getInitialStatusId } from '@/lib/services/orderStatuses';
import { dealScopeWhere } from './board';
import { resolveDealStages } from './stages';

/**
 * Этап 6 PR-2 (ФТ-4.4) — конверсии: Лид → Сделка и Сделка → Заказ (выигрыш).
 * Staff-only; заказ создаётся локальным (externalId null — 1С-синк не трогает),
 * по паттерну promoteLead.
 */

function isStaff(session: SessionPayload): boolean {
  return session.role === 'admin' || isStaffManagerSide(session);
}

export type ConvertLeadResult =
  | { ok: true; deal: Deal; lead: Lead }
  | { ok: false; error: 'forbidden' | 'not_found' | 'lifecycle_violation' };

/**
 * «Создать сделку» из лида (решение §9-1 спеки: лид получает терминальный
 * статус «Передана в сделку»). Компания сделки — организации лида, иначе
 * компании сессии (admin без companyId и без организации — forbidden:
 * сделке обязательна C8-граница). Организация/менеджер наследуются.
 */
export async function convertLeadToDeal(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { leadId: string }
): Promise<ConvertLeadResult> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };

  const lead = await prisma.lead.findUnique({
    where: { id: args.leadId },
    select: {
      id: true,
      status: true,
      subject: true,
      estimatedAmount: true,
      organizationId: true,
      assignedManagerId: true,
      promotedOrderId: true,
      promotedDealId: true,
      organization: { select: { companyId: true } },
    },
  });
  if (!lead) return { ok: false, error: 'not_found' };
  if (
    lead.status === 'promoted_to_order' ||
    lead.status === 'promoted_to_deal' ||
    lead.status === 'rejected' ||
    lead.promotedOrderId ||
    lead.promotedDealId
  ) {
    return { ok: false, error: 'lifecycle_violation' };
  }

  const companyId = lead.organization?.companyId ?? session.companyId ?? null;
  if (!companyId) return { ok: false, error: 'forbidden' };

  const { deal, updatedLead } = await prisma.$transaction(async (tx) => {
    const deal = await tx.deal.create({
      data: {
        companyId,
        leadId: lead.id,
        organizationId: lead.organizationId,
        title: lead.subject,
        amount: lead.estimatedAmount,
        managerId: lead.assignedManagerId ?? session.sub,
      },
    });
    const updatedLead = await tx.lead.update({
      where: { id: lead.id },
      data: { status: 'promoted_to_deal', promotedDealId: deal.id },
    });
    return { deal, updatedLead };
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'lead_promoted_to_deal',
    entity: 'lead',
    entityId: lead.id,
    after: { dealId: deal.id },
  });

  return { ok: true, deal, lead: updatedLead };
}

export type WinDealResult =
  | { ok: true; deal: Deal; order: Order }
  | { ok: false; error: 'forbidden' | 'not_found' | 'lifecycle_violation' | 'org_required' };

/**
 * «Выиграна → создать заказ» (решение §9-3 спеки: заказ создаётся сразу при
 * подтверждении, организация обязательна). Заказ локальный: externalId null,
 * managerId = ответственный сделки (иначе — инициатор), partnerId — из
 * лида-источника, если он был партнёрским.
 */
export async function winDeal(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { dealId: string; toStageId?: string }
): Promise<WinDealResult> {
  if (!isStaff(session) || (session.role !== 'admin' && !session.companyId)) {
    return { ok: false, error: 'forbidden' };
  }

  const deal = await prisma.deal.findFirst({
    where: { AND: [{ id: args.dealId }, dealScopeWhere(session)] },
    select: {
      id: true,
      status: true,
      title: true,
      amount: true,
      companyId: true,
      organizationId: true,
      managerId: true,
      lead: { select: { partnerId: true } },
    },
  });
  if (!deal) return { ok: false, error: 'not_found' };
  if (deal.status !== 'open') return { ok: false, error: 'lifecycle_violation' };
  if (!deal.organizationId) return { ok: false, error: 'org_required' };

  // Если указана целевая стадия — она должна быть won-стадией словаря компании сделки.
  let persistStageId: string | null = null;
  if (args.toStageId) {
    const stages = await resolveDealStages(prisma, deal.companyId);
    const target = stages.find((s) => s.id === args.toStageId);
    if (!target || target.statusAnchor !== 'won')
      return { ok: false, error: 'lifecycle_violation' };
    persistStageId = args.toStageId.startsWith('default:') ? null : args.toStageId;
  }

  const organizationId = deal.organizationId;
  const { order, updatedDeal } = await prisma.$transaction(async (tx) => {
    // §10 ТЗ v0.5: новая заявка получает рабочий статус из справочника.
    const initialStatusId = await getInitialStatusId(tx);
    const order = await tx.order.create({
      data: {
        statusId: initialStatusId,
        title: deal.title,
        companyId: deal.companyId,
        organizationId,
        partnerId: deal.lead?.partnerId ?? null,
        managerId: deal.managerId ?? session.sub,
        totalAmount: deal.amount ?? 0,
        executionStatus: 'pending',
        financialStatus: 'not_billed',
      },
    });
    const updatedDeal = await tx.deal.update({
      where: { id: deal.id },
      data: { status: 'won', wonAt: new Date(), orderId: order.id, stageId: persistStageId },
    });
    return { order, updatedDeal };
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'deal_won_order_created',
    entity: 'deal',
    entityId: deal.id,
    after: { orderId: order.id, organizationId },
  });

  return { ok: true, deal: updatedDeal, order };
}
