/**
 * Unit-тесты src/lib/services/deals/stages.ts (этап 6, ФТ-4.2).
 *
 *   - DEFAULT_DEAL_STAGES: 5 стадий (3 рабочих open + won + lost), позиции 0..4;
 *   - resolveDealStages: без кастомных стадий — копии дефолтов, с кастомными —
 *     маппинг полей строки в DealStageView;
 *   - stageForDeal: явная stageId; несуществующая stageId → фолбэк по якорю;
 *     у якоря open несколько стадий → первая подходящая.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_DEAL_STAGES,
  resolveDealStages,
  stageForDeal,
  type DealStageView,
} from '@/lib/services/deals/stages';

function makePrisma(rows: unknown[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  return { prisma: { dealStage: { findMany } } as unknown as PrismaClient, findMany };
}

describe('DEFAULT_DEAL_STAGES', () => {
  it('5 стадий: якоря open/open/open/won/lost, позиции 0..4', () => {
    expect(DEFAULT_DEAL_STAGES.map((s) => s.id)).toEqual([
      'default:new',
      'default:negotiation',
      'default:proposal',
      'default:won',
      'default:lost',
    ]);
    expect(DEFAULT_DEAL_STAGES.map((s) => s.statusAnchor)).toEqual([
      'open',
      'open',
      'open',
      'won',
      'lost',
    ]);
    expect(DEFAULT_DEAL_STAGES.map((s) => s.position)).toEqual([0, 1, 2, 3, 4]);
    // `У-164` (этап 7): стадия называется тем, что на ней ПРОИЗОШЛО.
    // «Предложение» не отвечало на вопрос «в каком мы состоянии»: его могли
    // ещё готовить. Названия читает заказчик — проверяем буквально.
    expect(DEFAULT_DEAL_STAGES.map((s) => s.name)).toEqual([
      'Новая',
      'Переговоры',
      'КП отправлено',
      'Выиграна',
      'Проиграна',
    ]);
  });

  it('терминальны ровно won/lost; у всех дефолтов color=null', () => {
    expect(DEFAULT_DEAL_STAGES.filter((s) => s.isTerminal).map((s) => s.id)).toEqual([
      'default:won',
      'default:lost',
    ]);
    expect(DEFAULT_DEAL_STAGES.every((s) => s.color === null)).toBe(true);
  });
});

describe('resolveDealStages', () => {
  it('без кастомных стадий → дефолты, причём КОПИИ (мутация результата не портит константу)', async () => {
    const { prisma, findMany } = makePrisma([]);
    const stages = await resolveDealStages(prisma, 'c1');
    expect(stages).toEqual([...DEFAULT_DEAL_STAGES]);
    expect(stages[0]).not.toBe(DEFAULT_DEAL_STAGES[0]); // копия, не ссылка
    expect(findMany).toHaveBeenCalledWith({
      where: { companyId: 'c1' },
      orderBy: { position: 'asc' },
    });
  });

  it('кастомные стадии → маппинг только view-полей (лишние колонки отбрасываются)', async () => {
    const row = {
      id: 'st-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      companyId: 'c1',
      name: 'Первичный контакт',
      position: 3,
      statusAnchor: 'open',
      isTerminal: false,
      color: '#22C55E',
    };
    const { prisma } = makePrisma([row]);
    const stages = await resolveDealStages(prisma, 'c1');
    expect(stages).toEqual([
      {
        id: 'st-1',
        name: 'Первичный контакт',
        position: 3,
        statusAnchor: 'open',
        isTerminal: false,
        color: '#22C55E',
      },
    ]);
  });
});

describe('stageForDeal', () => {
  const defaults: DealStageView[] = DEFAULT_DEAL_STAGES.map((s) => ({ ...s }));

  it('явная stageId, существующая в наборе', () => {
    expect(stageForDeal(defaults, { status: 'open', stageId: 'default:proposal' })?.id).toBe(
      'default:proposal'
    );
  });

  it('несуществующая stageId → фолбэк по якорю status', () => {
    expect(stageForDeal(defaults, { status: 'won', stageId: 'stale-cuid' })?.id).toBe(
      'default:won'
    );
  });

  it('stageId=null при нескольких open-стадиях → ПЕРВАЯ подходящая', () => {
    expect(stageForDeal(defaults, { status: 'open', stageId: null })?.id).toBe('default:new');
  });

  it('якорь без стадии в наборе → undefined (карточка не показывается)', () => {
    const onlyOpen = defaults.filter((s) => s.statusAnchor === 'open');
    expect(stageForDeal(onlyOpen, { status: 'lost', stageId: null })).toBeUndefined();
  });
});
