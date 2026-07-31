import type { DealStatus, PrismaClient } from '@prisma/client';

/**
 * Этап 6 (ФТ-4.2) — стадии сделок. Словарь `DealStage` (company-scoped) поверх
 * enum-якорей `DealStatus`; без кастомных стадий у компании — дефолтные.
 * Клон паттерна funnel/stages: `id` дефолта — синтетический `default:<ключ>`,
 * кастомной — реальный cuid.
 */

export type DealStageView = {
  id: string;
  name: string;
  position: number;
  statusAnchor: DealStatus;
  isTerminal: boolean;
  color: string | null;
};

/** Дефолтный конвейер сделок (§3 спеки): 3 рабочих + 2 терминальных стадии. */
export const DEFAULT_DEAL_STAGES: readonly DealStageView[] = [
  {
    id: 'default:new',
    name: 'Новая',
    position: 0,
    statusAnchor: 'open',
    isTerminal: false,
    color: null,
  },
  {
    id: 'default:negotiation',
    name: 'Переговоры',
    position: 1,
    statusAnchor: 'open',
    isTerminal: false,
    color: null,
  },
  {
    id: 'default:proposal',
    name: 'Предложение',
    position: 2,
    statusAnchor: 'open',
    isTerminal: false,
    color: null,
  },
  {
    id: 'default:won',
    name: 'Выиграна',
    position: 3,
    statusAnchor: 'won',
    isTerminal: true,
    color: null,
  },
  {
    id: 'default:lost',
    name: 'Проиграна',
    position: 4,
    statusAnchor: 'lost',
    isTerminal: true,
    color: null,
  },
];

/** Стадии компании: кастомные (если заданы) или дефолтные. */
export async function resolveDealStages(
  prisma: PrismaClient,
  companyId: string
): Promise<DealStageView[]> {
  const custom = await prisma.dealStage.findMany({
    where: { companyId },
    orderBy: { position: 'asc' },
  });
  if (custom.length === 0) return DEFAULT_DEAL_STAGES.map((s) => ({ ...s }));
  return custom.map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    statusAnchor: s.statusAnchor,
    isTerminal: s.isTerminal,
    color: s.color,
  }));
}

/**
 * Стадия сделки: явная `stageId` (если существует среди stages), иначе первая
 * стадия с якорем = status сделки. В отличие от воронки у якоря `open`
 * несколько стадий — дефолт по якорю всегда ПЕРВАЯ подходящая (позиция).
 */
export function stageForDeal(
  stages: DealStageView[],
  deal: { status: DealStatus; stageId: string | null }
): DealStageView | undefined {
  if (deal.stageId) {
    const explicit = stages.find((s) => s.id === deal.stageId);
    if (explicit) return explicit;
  }
  return stages.find((s) => s.statusAnchor === deal.status);
}
