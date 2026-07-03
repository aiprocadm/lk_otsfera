import type { PrismaClient, LeadStatus } from '@prisma/client';

/**
 * Трек G2 — стадии воронки продаж. Словарь `FunnelStage` (company-scoped) поверх
 * enum-якорей `LeadStatus`; если у компании нет кастомных стадий — используются
 * дефолтные (эта константа). `id` дефолта — `default:<anchor>` (синтетический,
 * стабильный); кастомной — реальный cuid.
 */

export type FunnelStageView = {
  id: string;
  name: string;
  position: number;
  statusAnchor: LeadStatus;
  isTerminal: boolean;
  color: string | null;
};

/** Дефолтная воронка (§24.3 ТЗ): 3 рабочих + 2 терминальных стадии над якорями. */
export const DEFAULT_FUNNEL_STAGES: readonly FunnelStageView[] = [
  { id: 'default:new', name: 'Новый лид', position: 0, statusAnchor: 'new', isTerminal: false, color: null },
  { id: 'default:in_review', name: 'В работе', position: 1, statusAnchor: 'in_review', isTerminal: false, color: null },
  { id: 'default:qualified', name: 'Квалифицирован', position: 2, statusAnchor: 'qualified', isTerminal: false, color: null },
  { id: 'default:promoted_to_order', name: 'Передано в работу', position: 3, statusAnchor: 'promoted_to_order', isTerminal: true, color: null },
  { id: 'default:rejected', name: 'Отказ', position: 4, statusAnchor: 'rejected', isTerminal: true, color: null }
];

/** Стадии компании: кастомные (если заданы) или дефолтные. */
export async function resolveFunnelStages(prisma: PrismaClient, companyId: string): Promise<FunnelStageView[]> {
  const custom = await prisma.funnelStage.findMany({ where: { companyId }, orderBy: { position: 'asc' } });
  if (custom.length === 0) return DEFAULT_FUNNEL_STAGES.map((s) => ({ ...s }));
  return custom.map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    statusAnchor: s.statusAnchor,
    isTerminal: s.isTerminal,
    color: s.color
  }));
}

/**
 * Стадия, в которую попадает лид: явная `funnelStageId` (если существует среди
 * stages), иначе первая стадия с якорем = status лида (дефолтная для якоря).
 */
export function stageForLead(
  stages: FunnelStageView[],
  lead: { status: LeadStatus; funnelStageId: string | null }
): FunnelStageView | undefined {
  if (lead.funnelStageId) {
    const explicit = stages.find((s) => s.id === lead.funnelStageId);
    if (explicit) return explicit;
  }
  return stages.find((s) => s.statusAnchor === lead.status);
}
