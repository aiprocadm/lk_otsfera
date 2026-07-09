import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { leadWhereForLevel, canSeeLead } from '@/lib/auth/accessProfile';
import { resolveFunnelStages, stageForLead, type FunnelStageView } from '@/lib/funnel/stages';
import { promoteLead, rejectLead, setLeadStatus } from '@/lib/services/manager/leadLifecycle';

/**
 * Трек G2 — доска воронки продаж (канбан). Лиды, сгруппированные по стадиям
 * (словарь `FunnelStage` или дефолты), в рамках leads-охвата профиля (G1).
 * `moveFunnelLead` — единая точка перемещения карточки: диспетчер поверх
 * существующего lead-lifecycle (`setLeadStatus`/`promoteLead`/`rejectLead`).
 *
 * §4 (внутренний контур): воронка — инструмент сотрудников. Staff-гейт
 * (admin|manager) — на service-слое, по образцу tasks/staffGate: middleware и
 * page-гарды режут клиентские роли раньше, но canSeeLead без accessProfile
 * возвращает true team-wide и роль не проверяет — без этого гейта
 * partner/organization-сессия с заполненным companyId прошла бы в мутацию.
 */

function isStaff(session: SessionPayload): boolean {
  return session.role === 'admin' || session.role === 'manager';
}

export type FunnelCard = {
  id: string;
  clientCompanyName: string;
  subject: string;
  estimatedAmount: string | null;
  organizationName: string | null;
  assignedManagerName: string | null;
  createdAt: Date;
};

export type FunnelColumn = { stage: FunnelStageView; cards: FunnelCard[] };
export type FunnelBoard = { stages: FunnelStageView[]; columns: FunnelColumn[] };

const CARD_INCLUDE = {
  organization: { select: { name: true } },
  assignedManager: { select: { name: true } }
} as const;

export async function getFunnelBoard(prisma: PrismaClient, session: SessionPayload): Promise<FunnelBoard> {
  // Клиентская роль → пустая доска (не leak-аем ни лиды, ни словарь стадий).
  if (!isStaff(session)) return { stages: [], columns: [] };
  const stages = await resolveFunnelStages(prisma, session.companyId ?? '');
  const where = session.accessProfile ? leadWhereForLevel(session, session.accessProfile.leads) : {};

  const leads = await prisma.lead.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true, clientCompanyName: true, subject: true, estimatedAmount: true,
      status: true, funnelStageId: true, createdAt: true, ...CARD_INCLUDE
    }
  });

  const columns: FunnelColumn[] = stages.map((stage) => ({ stage, cards: [] }));
  const byStageId = new Map(columns.map((c) => [c.stage.id, c]));

  for (const l of leads) {
    const stage = stageForLead(stages, l);
    if (!stage) continue; // якорь без стадии (напр. rejected скрыт из воронки) — пропускаем
    byStageId.get(stage.id)?.cards.push({
      id: l.id,
      clientCompanyName: l.clientCompanyName,
      subject: l.subject,
      estimatedAmount: l.estimatedAmount ? l.estimatedAmount.toFixed(2) : null,
      organizationName: l.organization?.name ?? null,
      assignedManagerName: l.assignedManager?.name ?? null,
      createdAt: l.createdAt
    });
  }

  return { stages, columns };
}

export type MoveFunnelLeadError =
  | 'not_found'
  | 'forbidden'
  | 'invalid_stage'
  | 'lifecycle_violation'
  | 'reason_required'
  | 'org_required';

export async function moveFunnelLead(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { leadId: string; toStageId: string; reason?: string }
): Promise<{ ok: true } | { ok: false; error: MoveFunnelLeadError }> {
  if (!isStaff(session) || !session.companyId) return { ok: false, error: 'forbidden' };

  const stages = await resolveFunnelStages(prisma, session.companyId);
  const target = stages.find((s) => s.id === args.toStageId);
  if (!target) return { ok: false, error: 'invalid_stage' };

  const lead = await prisma.lead.findUnique({
    where: { id: args.leadId },
    select: { id: true, status: true, funnelStageId: true, organizationId: true, assignedManagerId: true }
  });
  if (!lead) return { ok: false, error: 'not_found' };
  if (!canSeeLead(session, lead)) return { ok: false, error: 'not_found' }; // scope: не leak-аем

  // Синтетический дефолт-id (`default:*`) не FK — funnelStageId остаётся null
  // (позиция карточки выводится из status-якоря); кастомная стадия → реальный cuid.
  const persistStageId = args.toStageId.startsWith('default:') ? null : args.toStageId;

  // Внутри якоря — только переставляем карточку (без lifecycle-перехода).
  if (target.statusAnchor === lead.status) {
    await prisma.lead.update({ where: { id: lead.id }, data: { funnelStageId: persistStageId } });
    return { ok: true };
  }

  // Смена якоря → lifecycle-переход.
  const anchor = target.statusAnchor;
  if (anchor === 'promoted_to_order') {
    if (!lead.organizationId) return { ok: false, error: 'org_required' };
    const r = await promoteLead(prisma, { leadId: lead.id, managerId: session.sub });
    // lead was pre-checked to exist (L85-90), so the inner `not_found` mapping is an
    // unreachable race guard here — only lifecycle_violation is reachable.
    /* v8 ignore next */
    if (!r.ok) return { ok: false, error: r.error === 'not_found' ? 'not_found' : 'lifecycle_violation' };
  } else if (anchor === 'rejected') {
    const reason = (args.reason ?? '').trim();
    if (!reason) return { ok: false, error: 'reason_required' };
    const r = await rejectLead(prisma, { leadId: lead.id, managerId: session.sub, reason });
    /* v8 ignore next -- pre-checked lead → inner not_found unreachable (see above) */
    if (!r.ok) return { ok: false, error: r.error === 'not_found' ? 'not_found' : 'lifecycle_violation' };
  } else {
    const r = await setLeadStatus(prisma, { leadId: lead.id, managerId: session.sub, status: anchor });
    /* v8 ignore next -- pre-checked lead → inner not_found unreachable (see above) */
    if (!r.ok) return { ok: false, error: r.error === 'not_found' ? 'not_found' : 'lifecycle_violation' };
  }

  await prisma.lead.update({ where: { id: lead.id }, data: { funnelStageId: persistStageId } });
  return { ok: true };
}
