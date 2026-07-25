/**
 * Этап 6 — интеграционный цикл сделок против живого Postgres:
 * createDeal → доска (скоуп менеджера / чужой компании / leader + фильтр) →
 * кастомные стадии заменяют дефолты → moveDeal в кастомную open-стадию
 * (stageId персистится) → lost с причиной → lifecycle_violation на повторный
 * move → deleteDealStage (FK SetNull, карточка падает в дефолт по якорю).
 *
 * Запуск: npx vitest run --mode=integration src/__tests__/services.deals.integration.test.ts
 * Префикс данных: deal6-int. Cleanup — beforeAll (хвосты прошлых прогонов) + afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createDeal } from '@/lib/services/deals/crud';
import { getDealBoard, moveDeal } from '@/lib/services/deals/board';
import { createDealStage, deleteDealStage } from '@/lib/services/access/dealStages';
import type { SessionPayload } from '@/lib/auth/jwt';

const P = 'deal6-int';
let prisma: PrismaClient;
let companyA: string, companyB: string, orgA: string;
let leaderAId: string, mgrA1Id: string, mgrA2Id: string, mgrBId: string;

const leaderA = (): SessionPayload => ({ sub: leaderAId, role: 'manager', managerRole: 'leader', companyId: companyA });
const mgrA1 = (): SessionPayload => ({ sub: mgrA1Id, role: 'manager', companyId: companyA });
const mgrA2 = (): SessionPayload => ({ sub: mgrA2Id, role: 'manager', companyId: companyA });
const mgrB = (): SessionPayload => ({ sub: mgrBId, role: 'manager', companyId: companyB });

function boardCardIds(board: Awaited<ReturnType<typeof getDealBoard>>): string[] {
  return board.columns.flatMap((c) => c.cards.map((card) => card.id));
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { contains: P } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const companies = await prisma.company.findMany({ where: { name: { startsWith: P } }, select: { id: true } });
  const companyIds = companies.map((c) => c.id);
  if (userIds.length) await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  if (companyIds.length) {
    await prisma.deal.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.dealStage.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.organization.deleteMany({ where: { companyId: { in: companyIds } } });
  }
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (companyIds.length) await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
}

beforeAll(async () => {
  prisma = new PrismaClient();
  await cleanup(); // хвосты упавших прошлых прогонов
  companyA = (await prisma.company.create({ data: { name: `${P}-coA` } })).id;
  companyB = (await prisma.company.create({ data: { name: `${P}-coB` } })).id;
  orgA = (await prisma.organization.create({ data: { name: `${P}-orgA`, companyId: companyA } })).id;
  leaderAId = (await prisma.user.create({ data: { email: `${P}-leaderA@t.local`, name: 'Лидер А', role: 'manager', managerRole: 'leader', companyId: companyA } })).id;
  mgrA1Id = (await prisma.user.create({ data: { email: `${P}-mgrA1@t.local`, name: 'Менеджер А1', role: 'manager', companyId: companyA } })).id;
  mgrA2Id = (await prisma.user.create({ data: { email: `${P}-mgrA2@t.local`, name: 'Менеджер А2', role: 'manager', companyId: companyA } })).id;
  mgrBId = (await prisma.user.create({ data: { email: `${P}-mgrB@t.local`, name: 'Менеджер Б', role: 'manager', companyId: companyB } })).id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

let deal1: string; // сделка mgrA1 (пройдёт полный цикл до lost)
let deal2: string; // сделка mgrA2 (для leader-фильтра и SetNull-сценария)
let stWork: string; // кастомная open-стадия pos1 (будет удалена)
let stFirst: string; // кастомная open-стадия pos0 (дефолт по якорю после удаления)
let stLost: string; // кастомная lost-стадия

describe('полный цикл сделки', () => {
  it('createDeal менеджером: сделка создана в компании сессии, аудит deal_created', async () => {
    const res = await createDeal(prisma, mgrA1(), {
      title: `${P} Поставка обучения`,
      amount: '1500,50',
      organizationId: orgA,
      expectedCloseAt: '2026-12-01'
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    deal1 = res.deal.id;
    const row = await prisma.deal.findUniqueOrThrow({ where: { id: deal1 } });
    expect(row.companyId).toBe(companyA);
    expect(row.managerId).toBe(mgrA1Id); // дефолт — sub сессии
    expect(row.amount?.toFixed(2)).toBe('1500.50');
    expect(row.status).toBe('open');
    expect(
      await prisma.auditLog.findFirst({ where: { entity: 'deal', entityId: deal1, action: 'deal_created' } })
    ).not.toBeNull();

    const res2 = await createDeal(prisma, mgrA2(), { title: `${P} Вторая сделка` });
    expect(res2.ok).toBe(true);
    if (res2.ok) deal2 = res2.deal.id;
  });

  it('доска менеджера: своя сделка видна (в «Новая»), чужая — нет', async () => {
    const board = await getDealBoard(prisma, mgrA1());
    expect(board.stages.map((s) => s.id)).toEqual([
      'default:new',
      'default:negotiation',
      'default:proposal',
      'default:won',
      'default:lost'
    ]);
    const ids = boardCardIds(board);
    expect(ids).toContain(deal1);
    expect(ids).not.toContain(deal2); // сделка коллеги — вне скоупа рядового менеджера
    const newCol = board.columns.find((c) => c.stage.id === 'default:new')!;
    expect(newCol.cards.some((c) => c.id === deal1)).toBe(true);
  });

  it('доска менеджера ДРУГОЙ компании: сделок компании А нет', async () => {
    const ids = boardCardIds(await getDealBoard(prisma, mgrB()));
    expect(ids).not.toContain(deal1);
    expect(ids).not.toContain(deal2);
  });

  it('leader видит обе сделки компании; фильтр managerId сужает до одной', async () => {
    const all = boardCardIds(await getDealBoard(prisma, leaderA()));
    expect(all).toContain(deal1);
    expect(all).toContain(deal2);
    const filtered = boardCardIds(await getDealBoard(prisma, leaderA(), { managerId: mgrA1Id }));
    expect(filtered).toContain(deal1);
    expect(filtered).not.toContain(deal2);
  });

  it('кастомные стадии (createDealStage) заменяют дефолты на доске', async () => {
    const mk = async (name: string, position: number, statusAnchor: 'open' | 'won' | 'lost') => {
      const r = await createDealStage(prisma, leaderA(), { name: `${P} ${name}`, position, statusAnchor });
      expect(r.ok).toBe(true);
      return r.ok ? r.id : '';
    };
    stFirst = await mk('Первичный контакт', 0, 'open');
    stWork = await mk('В работе', 1, 'open');
    await mk('Успех', 2, 'won');
    stLost = await mk('Провал', 3, 'lost');

    const board = await getDealBoard(prisma, mgrA1());
    expect(board.stages.map((s) => s.id)).toEqual(expect.not.arrayContaining(['default:new']));
    expect(board.stages.map((s) => s.name)).toEqual([
      `${P} Первичный контакт`,
      `${P} В работе`,
      `${P} Успех`,
      `${P} Провал`
    ]);
    // stageId у сделок null → фолбэк по якорю open = ПЕРВАЯ open-стадия.
    const firstCol = board.columns.find((c) => c.stage.id === stFirst)!;
    expect(firstCol.cards.some((c) => c.id === deal1)).toBe(true);
  });

  it('moveDeal в кастомную open-стадию персистит stageId + аудит', async () => {
    expect(await moveDeal(prisma, mgrA1(), { dealId: deal1, toStageId: stWork })).toEqual({ ok: true });
    const row = await prisma.deal.findUniqueOrThrow({ where: { id: deal1 } });
    expect(row.stageId).toBe(stWork);
    expect(row.status).toBe('open');
    expect(
      await prisma.auditLog.findFirst({ where: { entity: 'deal', entityId: deal1, action: 'deal_stage_changed' } })
    ).not.toBeNull();
    // deal2 переводит leader (company-скоуп) — для SetNull-сценария ниже.
    expect(await moveDeal(prisma, leaderA(), { dealId: deal2, toStageId: stWork })).toEqual({ ok: true });
  });

  it('lost: без причины → reason_required; с причиной → status/lostAt/lostReason', async () => {
    expect(await moveDeal(prisma, mgrA1(), { dealId: deal1, toStageId: stLost })).toEqual({
      ok: false,
      error: 'reason_required'
    });
    expect(
      await moveDeal(prisma, mgrA1(), { dealId: deal1, toStageId: stLost, lostReason: 'Клиент выбрал конкурента' })
    ).toEqual({ ok: true });
    const row = await prisma.deal.findUniqueOrThrow({ where: { id: deal1 } });
    expect(row.status).toBe('lost');
    expect(row.lostAt).not.toBeNull();
    expect(row.lostReason).toBe('Клиент выбрал конкурента');
    expect(row.stageId).toBe(stLost);
  });

  it('повторный move завершённой сделки → lifecycle_violation', async () => {
    expect(await moveDeal(prisma, mgrA1(), { dealId: deal1, toStageId: stWork })).toEqual({
      ok: false,
      error: 'lifecycle_violation'
    });
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal1 } })).status).toBe('lost');
  });

  it('удаление стадии → FK SetNull: карточка вернулась к дефолту по якорю', async () => {
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal2 } })).stageId).toBe(stWork);
    expect(await deleteDealStage(prisma, leaderA(), stWork)).toEqual({ ok: true });
    const row = await prisma.deal.findUniqueOrThrow({ where: { id: deal2 } });
    expect(row.stageId).toBeNull(); // ON DELETE SET NULL
    expect(row.status).toBe('open');
    // На доске deal2 упал в первую open-стадию (дефолт по якорю).
    const board = await getDealBoard(prisma, leaderA());
    const firstCol = board.columns.find((c) => c.stage.id === stFirst)!;
    expect(firstCol.cards.some((c) => c.id === deal2)).toBe(true);
  });
});
