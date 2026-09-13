import type { DealStatus } from '@prisma/client';
import type { BitrixDeal } from '../source';
import { persistStageId, type TargetStage } from './stages';
import { dealStageKey, type MappingContext, type Plan, type PlanBefore } from './types';

/**
 * Сделка Битрикса → `Deal` (`У-191`, спека §3.3).
 *
 * Стадия — единственное, что нельзя угадать: сопоставление стадий портала и
 * стадий компании делает человек в предпросмотре (`У-193`), и до этого сделка
 * не переносится. Статус («открыта / выиграна / проиграна») берётся из якоря
 * выбранной стадии, а не из самого Битрикса: в ЛК смысл стадии задаёт компания.
 */
export type DealData = {
  companyId: string;
  title: string;
  amount: string | null;
  status: DealStatus;
  stageId: string | null;
  organizationId: string | null;
  contactId: string | null;
  leadId: string | null;
  managerId: string | null;
  expectedCloseAt: Date | null;
  wonAt: Date | null;
  lostAt: Date | null;
  bitrixId: string;
  /** Выигранная сделка просит заказ — считается отдельно (`У-197`, §3.5). */
  wantsOrder: boolean;
};

export type ExistingDeal = {
  id: string;
  title: string;
  status: DealStatus;
  stageId: string | null;
  orderId: string | null;
  organizationId: string | null;
};

export type DealLookup = {
  byBitrixId: (bitrixId: string) => ExistingDeal | undefined;
  organizationByBitrixId: (bitrixId: string) => string | undefined;
  contactByBitrixId: (bitrixId: string) => string | undefined;
  leadByBitrixId: (bitrixId: string) => string | undefined;
};

export function planDeal(
  deal: BitrixDeal,
  ctx: MappingContext,
  lookup: DealLookup,
  dealStages: readonly TargetStage[]
): Plan<DealData> {
  const key = dealStageKey(deal);
  const stageId = ctx.tables.stageMap[key] ?? null;
  const stage = stageId ? dealStages.find((s) => s.id === stageId) : undefined;
  if (!stage) {
    return { action: 'conflict', reason: 'stage_not_mapped', hint: `стадия «${deal.stageId}»` };
  }

  const status = stage.statusAnchor as DealStatus;
  const closeDate = deal.closeDate;
  const data: DealData = {
    companyId: ctx.companyId,
    title: deal.title.trim() || `Сделка Битрикс24 #${deal.id}`,
    amount: deal.opportunity,
    status,
    stageId: persistStageId(stage.id),
    organizationId: deal.companyId ? (lookup.organizationByBitrixId(deal.companyId) ?? null) : null,
    contactId: deal.contactId ? (lookup.contactByBitrixId(deal.contactId) ?? null) : null,
    leadId: deal.leadId ? (lookup.leadByBitrixId(deal.leadId) ?? null) : null,
    managerId: ctx.resolveUser(deal.assignedById) ?? ctx.defaultManagerId,
    // Дата закрытия в Битриксе одна: у открытой сделки это план, у закрытой — факт.
    expectedCloseAt: status === 'open' ? closeDate : null,
    wonAt: status === 'won' ? closeDate : null,
    lostAt: status === 'lost' ? closeDate : null,
    bitrixId: deal.id,
    wantsOrder: status === 'won',
  };

  const existing = lookup.byBitrixId(deal.id);
  if (!existing) return { action: 'create', data };

  const patch: Partial<DealData> = {};
  const before: PlanBefore<DealData> = {};
  if (data.title !== existing.title) {
    patch.title = data.title;
    before.title = existing.title;
  }
  if (data.status !== existing.status) {
    patch.status = data.status;
    patch.stageId = data.stageId;
    patch.wonAt = data.wonAt;
    patch.lostAt = data.lostAt;
    before.status = existing.status;
    before.stageId = existing.stageId;
  }
  if (data.organizationId && data.organizationId !== existing.organizationId) {
    patch.organizationId = data.organizationId;
    before.organizationId = existing.organizationId;
  }
  if (Object.keys(patch).length === 0) return { action: 'skip', reason: 'no_changes' };
  return { action: 'update', id: existing.id, data: patch, before };
}
