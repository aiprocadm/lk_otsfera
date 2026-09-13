import type { LeadSource, LeadStatus } from '@prisma/client';
import { isValidInn, normalizeInn } from '@/lib/services/oneCSync/inn';
import type { BitrixLead } from '../source';
import { persistStageId, type TargetStage } from './stages';
import type { MappingContext, Plan, PlanBefore } from './types';

/**
 * Лид Битрикса → `Lead` (`У-191`, спека §3.3).
 *
 * У лида в ЛК нет компании: он виден через ответственного менеджера, поэтому
 * лид без ответственного — конфликт, а не запись-невидимка. Обязательные
 * текстовые поля заполняются умолчаниями: история важнее пустых граф, и
 * штатный валидатор обращений к перенесённым лидам не применяется.
 */
export type LeadData = {
  source: LeadSource;
  status: LeadStatus;
  funnelStageId: string | null;
  subject: string;
  clientCompanyName: string;
  clientContactName: string;
  clientContactPhone: string | null;
  clientContactEmail: string | null;
  clientInn: string | null;
  estimatedAmount: string | null;
  organizationId: string | null;
  assignedManagerId: string;
  createdByUserId: string;
  notes: string | null;
  bitrixId: string;
};

export type ExistingLead = {
  id: string;
  subject: string;
  status: LeadStatus;
  funnelStageId: string | null;
};

export type LeadLookup = {
  byBitrixId: (bitrixId: string) => ExistingLead | undefined;
  /** Организация по названию компании из лида — лид Битрикса не хранит её id. */
  organizationByName: (name: string) => string | undefined;
};

export const NO_SUBJECT = 'Лид из Битрикс24';
export const NO_CLIENT_NAME = 'Без названия';

export function planLead(
  lead: BitrixLead,
  ctx: MappingContext,
  lookup: LeadLookup,
  funnelStages: readonly TargetStage[]
): Plan<LeadData> {
  const assignedManagerId = ctx.resolveUser(lead.assignedById) ?? ctx.defaultManagerId;
  if (!assignedManagerId) {
    return {
      action: 'conflict',
      reason: 'no_manager',
      hint: 'лид без ответственного не виден никому — выберите менеджера по умолчанию',
    };
  }

  const stageId = ctx.tables.leadStageMap[lead.statusId] ?? null;
  const stage = stageId ? funnelStages.find((s) => s.id === stageId) : undefined;
  if (!stage) {
    return { action: 'conflict', reason: 'stage_not_mapped', hint: `статус «${lead.statusId}»` };
  }

  const companyTitle = lead.companyTitle?.trim() ?? '';
  const normalizedInn = lead.inn ? normalizeInn(lead.inn) : null;
  const inn = normalizedInn && isValidInn(normalizedInn) ? normalizedInn : null;
  const organizationId =
    (companyTitle ? lookup.organizationByName(companyTitle) : undefined) ?? null;

  const data: LeadData = {
    source: 'bitrix',
    status: stage.statusAnchor as LeadStatus,
    funnelStageId: persistStageId(stage.id),
    subject: lead.title.trim() || NO_SUBJECT,
    clientCompanyName: companyTitle || NO_CLIENT_NAME,
    clientContactName: lead.name.trim() || NO_CLIENT_NAME,
    clientContactPhone: lead.phones[0] ?? null,
    clientContactEmail: lead.emails[0] ?? null,
    clientInn: inn,
    estimatedAmount: lead.opportunity,
    organizationId,
    assignedManagerId,
    createdByUserId: assignedManagerId,
    notes: lead.comments?.trim() || null,
    bitrixId: lead.id,
  };

  const existing = lookup.byBitrixId(lead.id);
  if (!existing) return { action: 'create', data };

  const patch: Partial<LeadData> = {};
  const before: PlanBefore<LeadData> = {};
  if (data.subject !== existing.subject) {
    patch.subject = data.subject;
    before.subject = existing.subject;
  }
  if (data.status !== existing.status) {
    patch.status = data.status;
    patch.funnelStageId = data.funnelStageId;
    before.status = existing.status;
    // Стадия воронки меняется вместе со статусом — без снимка откат оставил бы
    // лид в стадии, которая противоречит вернувшемуся статусу.
    before.funnelStageId = existing.funnelStageId;
  }
  if (Object.keys(patch).length === 0) return { action: 'skip', reason: 'no_changes' };
  return { action: 'update', id: existing.id, data: patch, before };
}
