/**
 * Unit-тесты src/lib/services/deals/board.ts (этап 6, ФТ-4.3) на prisma-моке.
 *
 *   - dealScopeWhere: admin — всё (+фильтр), leader — company (+фильтр),
 *     рядовой менеджер — company + свои, companyId null → sentinel '__none__';
 *   - getDealBoard: клиентская роль → пустая доска БЕЗ запросов; группировка
 *     карточек (явная stageId + фолбэк по статусу), маппинг DealCard;
 *   - moveDeal: forbidden / invalid_stage / not_found / lifecycle_violation /
 *     reason_required, персист stageId (default:* → null), терминалы, аудит.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { dealScopeWhere, getDealBoard, moveDeal } from '@/lib/services/deals/board';

// ─── helpers ──────────────────────────────────────────────────────────────────

const ADMIN: SessionPayload = { sub: 'adm-1', role: 'admin', companyId: 'c1' };
const ADMIN_NO_CO: SessionPayload = { sub: 'adm-0', role: 'admin' };
const LEADER: SessionPayload = { sub: 'ld-1', role: 'manager', managerRole: 'leader', companyId: 'c1' };
const MGR: SessionPayload = { sub: 'm-1', role: 'manager', companyId: 'c1' };
const PARTNER: SessionPayload = { sub: 'p-1', role: 'partner', partnerId: 'pt-1' };

/** Кастомный словарь: 2 open-стадии + won + lost (реальные cuid-подобные id). */
const CUSTOM_STAGES = [
  { id: 'st-a', companyId: 'c1', name: 'Первичный контакт', position: 0, statusAnchor: 'open', isTerminal: false, color: null },
  { id: 'st-b', companyId: 'c1', name: 'В работе', position: 1, statusAnchor: 'open', isTerminal: false, color: '#3B82F6' },
  { id: 'st-won', companyId: 'c1', name: 'Успех', position: 2, statusAnchor: 'won', isTerminal: true, color: null },
  { id: 'st-lost', companyId: 'c1', name: 'Провал', position: 3, statusAnchor: 'lost', isTerminal: true, color: null }
];

type Mocks = {
  stageFindMany: ReturnType<typeof vi.fn>;
  dealFindMany: ReturnType<typeof vi.fn>;
  dealFindFirst: ReturnType<typeof vi.fn>;
  dealUpdate: ReturnType<typeof vi.fn>;
};

function makePrisma(opts: { stages?: unknown[]; deals?: unknown[]; deal?: unknown } = {}): {
  prisma: PrismaClient;
} & Mocks {
  const stageFindMany = vi.fn().mockResolvedValue(opts.stages ?? []);
  const dealFindMany = vi.fn().mockResolvedValue(opts.deals ?? []);
  const dealFindFirst = vi.fn().mockResolvedValue(opts.deal ?? null);
  const dealUpdate = vi.fn().mockResolvedValue({});
  const prisma = {
    dealStage: { findMany: stageFindMany },
    deal: { findMany: dealFindMany, findFirst: dealFindFirst, update: dealUpdate }
  } as unknown as PrismaClient;
  return { prisma, stageFindMany, dealFindMany, dealFindFirst, dealUpdate };
}

function makeDeal(over: Record<string, unknown> = {}) {
  return {
    id: 'd-1',
    title: 'Сделка',
    amount: null,
    status: 'open',
    stageId: null,
    orderId: null,
    expectedCloseAt: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    organizationId: null,
    managerId: null,
    organization: null,
    manager: null,
    ...over
  };
}

function cardIds(board: Awaited<ReturnType<typeof getDealBoard>>, stageId: string): string[] {
  return board.columns.find((c) => c.stage.id === stageId)!.cards.map((c) => c.id);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── dealScopeWhere ───────────────────────────────────────────────────────────

describe('dealScopeWhere', () => {
  it('admin без фильтра → всё ({}), companyId сессии игнорируется', () => {
    expect(dealScopeWhere(ADMIN)).toEqual({});
    expect(dealScopeWhere(ADMIN_NO_CO)).toEqual({});
  });

  it('admin с фильтром по менеджеру → { managerId }', () => {
    expect(dealScopeWhere(ADMIN, { managerId: 'm-9' })).toEqual({ managerId: 'm-9' });
  });

  it('leader → company-floor; фильтр по менеджеру добавляется', () => {
    expect(dealScopeWhere(LEADER)).toEqual({ companyId: 'c1' });
    expect(dealScopeWhere(LEADER, { managerId: 'm-9' })).toEqual({ companyId: 'c1', managerId: 'm-9' });
  });

  it('рядовой менеджер → company + пришпилен к своим; фильтр opts игнорируется', () => {
    expect(dealScopeWhere(MGR)).toEqual({ companyId: 'c1', managerId: 'm-1' });
    expect(dealScopeWhere(MGR, { managerId: 'm-9' })).toEqual({ companyId: 'c1', managerId: 'm-1' });
  });

  it('companyId null → sentinel __none__ (ничего не матчится)', () => {
    expect(dealScopeWhere({ sub: 'ld-0', role: 'manager', managerRole: 'leader' })).toEqual({ companyId: '__none__' });
    expect(dealScopeWhere({ sub: 'm-0', role: 'manager', companyId: null })).toEqual({
      companyId: '__none__',
      managerId: 'm-0'
    });
  });
});

// ─── getDealBoard ─────────────────────────────────────────────────────────────

describe('getDealBoard', () => {
  it('клиентская роль → пустая доска и НИ ОДНОГО запроса в БД', async () => {
    const { prisma, stageFindMany, dealFindMany } = makePrisma();
    expect(await getDealBoard(prisma, PARTNER)).toEqual({ stages: [], columns: [] });
    expect(stageFindMany).not.toHaveBeenCalled();
    expect(dealFindMany).not.toHaveBeenCalled();
  });

  it('без кастомных стадий → 5 дефолтных колонок', async () => {
    const { prisma } = makePrisma();
    const board = await getDealBoard(prisma, MGR);
    expect(board.stages.map((s) => s.id)).toEqual([
      'default:new',
      'default:negotiation',
      'default:proposal',
      'default:won',
      'default:lost'
    ]);
    expect(board.columns.map((c) => c.cards.length)).toEqual([0, 0, 0, 0, 0]);
  });

  it('сотрудник без компании в сессии → словарь стадий запрашивается пустым companyId, доска не падает', async () => {
    // У админа компании в сессии может не быть вовсе (Model A — он над компаниями).
    // Резолвер стадий обязан получить пустую строку, а не undefined, иначе
    // выборка словаря сломается и доска не откроется.
    const { prisma, stageFindMany } = makePrisma();
    const board = await getDealBoard(prisma, ADMIN_NO_CO);
    expect(stageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: '' }) })
    );
    expect(board.columns.map((c) => c.cards.length)).toEqual([0, 0, 0, 0, 0]);
  });

  it('статус сделки без стадии в словаре → карточка не показывается (а не падает)', async () => {
    // Словарь можно настроить так, что для какого-то статуса стадии нет вовсе
    // (например, все терминальные стадии деактивировали). Такая сделка просто
    // не попадает на доску — доска остаётся рабочей.
    const openOnly = CUSTOM_STAGES.filter((s) => s.statusAnchor === 'open');
    const deals = [makeDeal({ id: 'd-open' }), makeDeal({ id: 'd-won-no-stage', status: 'won' })];
    const { prisma } = makePrisma({ stages: openOnly, deals });
    const board = await getDealBoard(prisma, LEADER);
    expect(board.columns.flatMap((c) => c.cards.map((x) => x.id))).toEqual(['d-open']);
  });

  it('группировка: явная stageId, фолбэк по статусу, битая stageId → первая open-стадия', async () => {
    const deals = [
      makeDeal({ id: 'd-explicit', stageId: 'st-b' }),
      makeDeal({ id: 'd-null-open' }),
      makeDeal({ id: 'd-won', status: 'won' }),
      makeDeal({ id: 'd-ghost', stageId: 'ghost-id' }) // stageId не из словаря → якорь open → st-a
    ];
    const { prisma, dealFindMany } = makePrisma({ stages: CUSTOM_STAGES, deals });
    const board = await getDealBoard(prisma, LEADER, { managerId: 'm-9' });
    expect(cardIds(board, 'st-a')).toEqual(['d-null-open', 'd-ghost']);
    expect(cardIds(board, 'st-b')).toEqual(['d-explicit']);
    expect(cardIds(board, 'st-won')).toEqual(['d-won']);
    expect(cardIds(board, 'st-lost')).toEqual([]);
    // Скоуп и фильтр прокинуты в findMany.
    expect(dealFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c1', managerId: 'm-9' }, take: 500 })
    );
  });

  it('маппинг DealCard: amount.toFixed(2), organizationId/managerId и имена; null-поля', async () => {
    const createdAt = new Date('2026-07-10T12:00:00.000Z');
    const closeAt = new Date('2026-09-01T00:00:00.000Z');
    const deals = [
      makeDeal({
        id: 'd-full',
        title: 'Полная',
        amount: 1234.5, // Decimal-совместимо: у number тоже есть toFixed
        organizationId: 'org-1',
        organization: { name: 'Орг' },
        managerId: 'm-1',
        manager: { name: 'Менеджер' },
        orderId: 'ord-1',
        expectedCloseAt: closeAt,
        createdAt
      }),
      makeDeal({ id: 'd-bare', title: 'Пустая', createdAt })
    ];
    const { prisma } = makePrisma({ deals });
    const board = await getDealBoard(prisma, MGR);
    const col = board.columns.find((c) => c.stage.id === 'default:new')!;
    expect(col.cards).toEqual([
      {
        id: 'd-full',
        title: 'Полная',
        amount: '1234.50',
        organizationId: 'org-1',
        organizationName: 'Орг',
        managerId: 'm-1',
        managerName: 'Менеджер',
        status: 'open',
        orderId: 'ord-1',
        expectedCloseAt: closeAt,
        createdAt
      },
      {
        id: 'd-bare',
        title: 'Пустая',
        amount: null,
        organizationId: null,
        organizationName: null,
        managerId: null,
        managerName: null,
        status: 'open',
        orderId: null,
        expectedCloseAt: null,
        createdAt
      }
    ]);
  });
});

// ─── moveDeal ─────────────────────────────────────────────────────────────────

describe('moveDeal — гейты', () => {
  it('клиентская роль → forbidden без запросов', async () => {
    const { prisma, stageFindMany } = makePrisma();
    expect(await moveDeal(prisma, PARTNER, { dealId: 'd-1', toStageId: 'default:won' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
    expect(stageFindMany).not.toHaveBeenCalled();
  });

  it('менеджер без companyId → forbidden; admin без companyId допущен (Model A)', async () => {
    const { prisma } = makePrisma();
    const MGR_NO_CO: SessionPayload = { sub: 'm-0', role: 'manager' };
    expect(await moveDeal(prisma, MGR_NO_CO, { dealId: 'd-1', toStageId: 'default:won' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
    // admin без companyId проходит гейт: стадии резолвятся по компании СДЕЛКИ.
    expect(await moveDeal(prisma, ADMIN_NO_CO, { dealId: 'd-x', toStageId: 'default:won' })).toEqual({
      ok: false,
      error: 'not_found' // сделки нет в моке — но не forbidden
    });
  });

  it('стадия вне словаря компании СДЕЛКИ → invalid_stage (стадии резолвятся после выборки сделки)', async () => {
    // Секьюрити-фикс: словарь стадий берётся по deal.companyId, не по сессии —
    // admin не может перевести чужую сделку в стадию своей компании.
    const { prisma, stageFindMany } = makePrisma({
      stages: CUSTOM_STAGES,
      deal: { id: 'd-1', status: 'open', stageId: null, companyId: 'c1' }
    });
    expect(await moveDeal(prisma, MGR, { dealId: 'd-1', toStageId: 'default:won' })).toEqual({
      ok: false,
      error: 'invalid_stage'
    });
    expect(stageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c1' } })
    );
  });

  it('сделка вне скоупа (чужая/несуществующая) → not_found; скоуп в самой выборке', async () => {
    const { prisma, dealFindFirst } = makePrisma();
    expect(await moveDeal(prisma, MGR, { dealId: 'd-alien', toStageId: 'default:negotiation' })).toEqual({
      ok: false,
      error: 'not_found'
    });
    expect(dealFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ id: 'd-alien' }, { companyId: 'c1', managerId: 'm-1' }] }
      })
    );
  });

  it('сделка уже завершена (won) → lifecycle_violation, update не вызывается', async () => {
    const { prisma, dealUpdate } = makePrisma({ deal: { id: 'd-1', status: 'won', stageId: null } });
    expect(await moveDeal(prisma, MGR, { dealId: 'd-1', toStageId: 'default:negotiation' })).toEqual({
      ok: false,
      error: 'lifecycle_violation'
    });
    expect(dealUpdate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe('moveDeal — перенос внутри open', () => {
  it('кастомная open-стадия → stageId персистится + аудит deal_stage_changed', async () => {
    const { prisma, dealUpdate } = makePrisma({
      stages: CUSTOM_STAGES,
      deal: { id: 'd-1', status: 'open', stageId: 'st-a' }
    });
    expect(await moveDeal(prisma, MGR, { dealId: 'd-1', toStageId: 'st-b' })).toEqual({ ok: true });
    expect(dealUpdate).toHaveBeenCalledWith({ where: { id: 'd-1' }, data: { stageId: 'st-b' } });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'm-1',
      action: 'deal_stage_changed',
      entity: 'deal',
      entityId: 'd-1',
      after: { toStageId: 'st-b' }
    });
  });

  it('синтетический default:* → в БД пишется stageId=null', async () => {
    const { prisma, dealUpdate } = makePrisma({ deal: { id: 'd-1', status: 'open', stageId: null } });
    expect(await moveDeal(prisma, MGR, { dealId: 'd-1', toStageId: 'default:proposal' })).toEqual({ ok: true });
    expect(dealUpdate).toHaveBeenCalledWith({ where: { id: 'd-1' }, data: { stageId: null } });
  });
});

describe('moveDeal — терминальные стадии', () => {
  it('lost без причины (в т.ч. пробелы) → reason_required, ничего не пишем', async () => {
    const { prisma, dealUpdate } = makePrisma({ deal: { id: 'd-1', status: 'open', stageId: null } });
    expect(await moveDeal(prisma, MGR, { dealId: 'd-1', toStageId: 'default:lost' })).toEqual({
      ok: false,
      error: 'reason_required'
    });
    expect(await moveDeal(prisma, MGR, { dealId: 'd-1', toStageId: 'default:lost', lostReason: '   ' })).toEqual({
      ok: false,
      error: 'reason_required'
    });
    expect(dealUpdate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('lost с причиной → status/lostAt/lostReason(trim)/stageId + аудит с якорем', async () => {
    const { prisma, dealUpdate } = makePrisma({
      stages: CUSTOM_STAGES,
      deal: { id: 'd-1', status: 'open', stageId: 'st-b' }
    });
    expect(
      await moveDeal(prisma, LEADER, { dealId: 'd-1', toStageId: 'st-lost', lostReason: '  клиент ушёл  ' })
    ).toEqual({ ok: true });
    expect(dealUpdate).toHaveBeenCalledWith({
      where: { id: 'd-1' },
      data: { status: 'lost', lostAt: expect.any(Date), lostReason: 'клиент ушёл', stageId: 'st-lost' }
    });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'ld-1',
      action: 'deal_stage_changed',
      entity: 'deal',
      entityId: 'd-1',
      after: { toStageId: 'st-lost', statusAnchor: 'lost' }
    });
  });

  it('won-стадия через move запрещена (инвариант «выигрыш = заказ») → won_requires_order', async () => {
    const { prisma, dealUpdate } = makePrisma({
      deal: { id: 'd-1', status: 'open', stageId: null, companyId: 'c1' }
    });
    expect(await moveDeal(prisma, MGR, { dealId: 'd-1', toStageId: 'default:won' })).toEqual({
      ok: false,
      error: 'won_requires_order'
    });
    expect(dealUpdate).not.toHaveBeenCalled();
  });
});
