/**
 * Unit-тесты src/lib/services/deals/convert.ts (этап 6, PR-2, ФТ-4.4) на prisma-моке.
 *
 *   - convertLeadToDeal: staff-гейт (partner/organization → forbidden), not_found,
 *     lifecycle_violation (терминальные статусы + заполненные promoted*Id),
 *     выбор companyId (организация лида приоритетнее сессии; без обоих → forbidden),
 *     транзакция (deal наследует organizationId/amount/subject, managerId =
 *     assignedManagerId ?? sub; лид → promoted_to_deal + promotedDealId),
 *     аудит lead_promoted_to_deal;
 *   - winDeal: гейты (клиент; менеджер без companyId; admin без companyId допущен),
 *     not_found вне скоупа, lifecycle_violation (won/lost), org_required,
 *     toStageId (не-won → lifecycle_violation; кастомная won-стадия компании
 *     СДЕЛКИ персистится; default:* → null), транзакция (заказ + сделка won),
 *     аудит deal_won_order_created.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { convertLeadToDeal, winDeal } from '@/lib/services/deals/convert';

// ─── helpers ──────────────────────────────────────────────────────────────────

const ADMIN: SessionPayload = { sub: 'adm-1', role: 'admin', companyId: 'c1' };
const ADMIN_NO_CO: SessionPayload = { sub: 'adm-0', role: 'admin' };
const MGR: SessionPayload = { sub: 'm-1', role: 'manager', companyId: 'c1' };
const MGR_NO_CO: SessionPayload = { sub: 'm-0', role: 'manager' };
const PARTNER: SessionPayload = { sub: 'p-1', role: 'partner', partnerId: 'pt-1' };
const ORG: SessionPayload = { sub: 'o-1', role: 'organization', organizationId: 'org-1' };

/** Конвертируемый лид (select из convertLeadToDeal). */
function makeLead(over: Record<string, unknown> = {}) {
  return {
    id: 'l-1',
    status: 'qualified',
    subject: 'Обучение по ОТ',
    estimatedAmount: 1500.5,
    organizationId: 'org-1',
    assignedManagerId: null,
    promotedOrderId: null,
    promotedDealId: null,
    organization: { companyId: 'c-org' },
    ...over
  };
}

function makeConvertPrisma(opts: { lead?: unknown } = {}) {
  const leadFindUnique = vi.fn().mockResolvedValue(opts.lead ?? null);
  const txDealCreate = vi.fn().mockResolvedValue({ id: 'deal-new' });
  const txLeadUpdate = vi
    .fn()
    .mockResolvedValue({ id: 'l-1', status: 'promoted_to_deal', promotedDealId: 'deal-new' });
  const tx = { deal: { create: txDealCreate }, lead: { update: txLeadUpdate } };
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
  const prisma = { lead: { findUnique: leadFindUnique }, $transaction } as unknown as PrismaClient;
  return { prisma, leadFindUnique, txDealCreate, txLeadUpdate, $transaction };
}

/** Открытая сделка (select из winDeal). */
function makeDeal(over: Record<string, unknown> = {}) {
  return {
    id: 'd-1',
    status: 'open',
    title: 'Сделка',
    amount: 500,
    companyId: 'c1',
    organizationId: 'org-1',
    managerId: 'm-9',
    lead: { partnerId: 'pt-1' },
    ...over
  };
}

/** Словарь стадий сделок компании c1: open + won (реальные cuid-подобные id). */
const DEAL_STAGES = [
  { id: 'st-open', companyId: 'c1', name: 'В работе', position: 0, statusAnchor: 'open', isTerminal: false, color: null },
  { id: 'st-won', companyId: 'c1', name: 'Успех', position: 1, statusAnchor: 'won', isTerminal: true, color: null }
];

function makeWinPrisma(opts: { deal?: unknown; stages?: unknown[] } = {}) {
  const dealFindFirst = vi.fn().mockResolvedValue(opts.deal ?? null);
  const stageFindMany = vi.fn().mockResolvedValue(opts.stages ?? []);
  const txOrderCreate = vi.fn().mockResolvedValue({ id: 'ord-1' });
  const txDealUpdate = vi.fn().mockResolvedValue({ id: 'd-1', status: 'won', orderId: 'ord-1' });
  // §10 ТЗ v0.5 (PR-3): создание заявки спрашивает у справочника начальный
  // статус — в транзакционном стабе он тоже должен быть.
  const tx = {
    order: { create: txOrderCreate },
    deal: { update: txDealUpdate },
    orderStatusDefinition: { findFirst: vi.fn().mockResolvedValue({ id: 'oss_draft' }) }
  };
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
  const prisma = {
    deal: { findFirst: dealFindFirst },
    dealStage: { findMany: stageFindMany },
    $transaction
  } as unknown as PrismaClient;
  return { prisma, dealFindFirst, stageFindMany, txOrderCreate, txDealUpdate, $transaction };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── convertLeadToDeal — гейты и lifecycle ────────────────────────────────────

describe('convertLeadToDeal — гейты', () => {
  it.each([PARTNER, ORG])('клиентская роль ($role) → forbidden без запросов', async (session) => {
    const { prisma, leadFindUnique } = makeConvertPrisma();
    expect(await convertLeadToDeal(prisma, session, { leadId: 'l-1' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
    expect(leadFindUnique).not.toHaveBeenCalled();
  });

  it('лид не найден → not_found', async () => {
    const { prisma, $transaction } = makeConvertPrisma();
    expect(await convertLeadToDeal(prisma, MGR, { leadId: 'l-ghost' })).toEqual({
      ok: false,
      error: 'not_found'
    });
    expect($transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['status=promoted_to_order', { status: 'promoted_to_order' }],
    ['status=promoted_to_deal', { status: 'promoted_to_deal' }],
    ['status=rejected', { status: 'rejected' }],
    ['заполнен promotedOrderId', { promotedOrderId: 'ord-9' }],
    ['заполнен promotedDealId', { promotedDealId: 'deal-9' }]
  ])('%s → lifecycle_violation, транзакция не стартует', async (_label, over) => {
    const { prisma, $transaction } = makeConvertPrisma({ lead: makeLead(over) });
    expect(await convertLeadToDeal(prisma, MGR, { leadId: 'l-1' })).toEqual({
      ok: false,
      error: 'lifecycle_violation'
    });
    expect($transaction).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe('convertLeadToDeal — выбор companyId', () => {
  it('companyId организации лида приоритетнее companyId сессии', async () => {
    const { prisma, txDealCreate } = makeConvertPrisma({ lead: makeLead() });
    const res = await convertLeadToDeal(prisma, MGR, { leadId: 'l-1' }); // сессия c1, орг c-org
    expect(res.ok).toBe(true);
    expect(txDealCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: 'c-org' }) })
    );
  });

  it('лид без организации → companyId сессии', async () => {
    const { prisma, txDealCreate } = makeConvertPrisma({
      lead: makeLead({ organizationId: null, organization: null })
    });
    const res = await convertLeadToDeal(prisma, MGR, { leadId: 'l-1' });
    expect(res.ok).toBe(true);
    expect(txDealCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: 'c1' }) })
    );
  });

  it('ни организации, ни companyId сессии (admin) → forbidden, транзакции нет', async () => {
    const { prisma, $transaction } = makeConvertPrisma({
      lead: makeLead({ organizationId: null, organization: null })
    });
    expect(await convertLeadToDeal(prisma, ADMIN_NO_CO, { leadId: 'l-1' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe('convertLeadToDeal — транзакция и аудит', () => {
  it('deal наследует организацию/сумму/тему, managerId = assignedManagerId лида', async () => {
    const { prisma, txDealCreate, txLeadUpdate } = makeConvertPrisma({
      lead: makeLead({ assignedManagerId: 'm-7' })
    });
    const res = await convertLeadToDeal(prisma, ADMIN, { leadId: 'l-1' });
    expect(res).toEqual({
      ok: true,
      deal: { id: 'deal-new' },
      lead: { id: 'l-1', status: 'promoted_to_deal', promotedDealId: 'deal-new' }
    });
    expect(txDealCreate).toHaveBeenCalledWith({
      data: {
        companyId: 'c-org',
        leadId: 'l-1',
        organizationId: 'org-1',
        title: 'Обучение по ОТ',
        amount: 1500.5,
        managerId: 'm-7'
      }
    });
    expect(txLeadUpdate).toHaveBeenCalledWith({
      where: { id: 'l-1' },
      data: { status: 'promoted_to_deal', promotedDealId: 'deal-new' }
    });
  });

  it('assignedManagerId null → managerId = sub сессии; аудит lead_promoted_to_deal', async () => {
    const { prisma, txDealCreate } = makeConvertPrisma({ lead: makeLead() });
    const res = await convertLeadToDeal(prisma, MGR, { leadId: 'l-1' });
    expect(res.ok).toBe(true);
    expect(txDealCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ managerId: 'm-1' }) })
    );
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'm-1',
      action: 'lead_promoted_to_deal',
      entity: 'lead',
      entityId: 'l-1',
      after: { dealId: 'deal-new' }
    });
  });
});

// ─── winDeal — гейты и предусловия ────────────────────────────────────────────

describe('winDeal — гейты', () => {
  it('клиентская роль → forbidden без запросов', async () => {
    const { prisma, dealFindFirst } = makeWinPrisma();
    expect(await winDeal(prisma, PARTNER, { dealId: 'd-1' })).toEqual({ ok: false, error: 'forbidden' });
    expect(dealFindFirst).not.toHaveBeenCalled();
  });

  it('менеджер без companyId → forbidden; admin без companyId допущен (Model A)', async () => {
    const { prisma } = makeWinPrisma();
    expect(await winDeal(prisma, MGR_NO_CO, { dealId: 'd-1' })).toEqual({ ok: false, error: 'forbidden' });
    // admin проходит гейт — сделки нет в моке, но это уже not_found, не forbidden.
    expect(await winDeal(prisma, ADMIN_NO_CO, { dealId: 'd-1' })).toEqual({ ok: false, error: 'not_found' });
  });

  it('сделка вне скоупа → not_found; скоуп менеджера в самой выборке', async () => {
    const { prisma, dealFindFirst } = makeWinPrisma();
    expect(await winDeal(prisma, MGR, { dealId: 'd-alien' })).toEqual({ ok: false, error: 'not_found' });
    expect(dealFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ id: 'd-alien' }, { companyId: 'c1', managerId: 'm-1' }] }
      })
    );
  });

  it.each(['won', 'lost'])('сделка в статусе %s → lifecycle_violation', async (status) => {
    const { prisma, $transaction } = makeWinPrisma({ deal: makeDeal({ status }) });
    expect(await winDeal(prisma, MGR, { dealId: 'd-1' })).toEqual({
      ok: false,
      error: 'lifecycle_violation'
    });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('сделка без организации → org_required (§9-3: заказу обязательна организация)', async () => {
    const { prisma, $transaction } = makeWinPrisma({ deal: makeDeal({ organizationId: null }) });
    expect(await winDeal(prisma, MGR, { dealId: 'd-1' })).toEqual({ ok: false, error: 'org_required' });
    expect($transaction).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe('winDeal — toStageId', () => {
  it('не-won стадия → lifecycle_violation; стадии резолвятся по компании СДЕЛКИ', async () => {
    const { prisma, stageFindMany, $transaction } = makeWinPrisma({
      deal: makeDeal({ companyId: 'c-deal' }),
      stages: DEAL_STAGES
    });
    expect(await winDeal(prisma, ADMIN, { dealId: 'd-1', toStageId: 'st-open' })).toEqual({
      ok: false,
      error: 'lifecycle_violation'
    });
    expect(stageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c-deal' } })
    );
    expect($transaction).not.toHaveBeenCalled();
  });

  it('стадия вне словаря → lifecycle_violation', async () => {
    const { prisma } = makeWinPrisma({ deal: makeDeal(), stages: DEAL_STAGES });
    expect(await winDeal(prisma, MGR, { dealId: 'd-1', toStageId: 'ghost' })).toEqual({
      ok: false,
      error: 'lifecycle_violation'
    });
  });

  it('кастомная won-стадия → stageId персистится в update сделки', async () => {
    const { prisma, txDealUpdate } = makeWinPrisma({ deal: makeDeal(), stages: DEAL_STAGES });
    const res = await winDeal(prisma, MGR, { dealId: 'd-1', toStageId: 'st-won' });
    expect(res.ok).toBe(true);
    expect(txDealUpdate).toHaveBeenCalledWith({
      where: { id: 'd-1' },
      data: { status: 'won', wonAt: expect.any(Date), orderId: 'ord-1', stageId: 'st-won' }
    });
  });

  it('синтетический default:won → stageId=null', async () => {
    const { prisma, txDealUpdate } = makeWinPrisma({ deal: makeDeal() }); // без кастомных → дефолты
    const res = await winDeal(prisma, MGR, { dealId: 'd-1', toStageId: 'default:won' });
    expect(res.ok).toBe(true);
    expect(txDealUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stageId: null }) })
    );
  });
});

describe('winDeal — транзакция и аудит', () => {
  it('заказ наследует сделку: title/companyId/organizationId, partnerId лида, managerId сделки, totalAmount', async () => {
    const { prisma, txOrderCreate, stageFindMany } = makeWinPrisma({ deal: makeDeal() });
    const res = await winDeal(prisma, MGR, { dealId: 'd-1' });
    expect(res.ok).toBe(true);
    expect(stageFindMany).not.toHaveBeenCalled(); // без toStageId словарь не нужен
    expect(txOrderCreate).toHaveBeenCalledWith({
      data: {
        // §10 ТЗ v0.5 (PR-3): новая заявка сразу получает рабочий статус
        statusId: 'oss_draft',
        title: 'Сделка',
        companyId: 'c1',
        organizationId: 'org-1',
        partnerId: 'pt-1',
        managerId: 'm-9',
        totalAmount: 500,
        executionStatus: 'pending',
        financialStatus: 'not_billed'
      }
    });
  });

  it('фолбэки: без лида → partnerId null, без менеджера → sub, без суммы → 0', async () => {
    const { prisma, txOrderCreate } = makeWinPrisma({
      deal: makeDeal({ lead: null, managerId: null, amount: null })
    });
    const res = await winDeal(prisma, MGR, { dealId: 'd-1' });
    expect(res.ok).toBe(true);
    expect(txOrderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ partnerId: null, managerId: 'm-1', totalAmount: 0 })
      })
    );
  });

  it('сделка → won/wonAt/orderId; аудит deal_won_order_created; результат несёт заказ', async () => {
    const { prisma, txDealUpdate } = makeWinPrisma({ deal: makeDeal() });
    const res = await winDeal(prisma, MGR, { dealId: 'd-1' });
    expect(res).toEqual({
      ok: true,
      deal: { id: 'd-1', status: 'won', orderId: 'ord-1' },
      order: { id: 'ord-1' }
    });
    expect(txDealUpdate).toHaveBeenCalledWith({
      where: { id: 'd-1' },
      data: { status: 'won', wonAt: expect.any(Date), orderId: 'ord-1', stageId: null }
    });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'm-1',
      action: 'deal_won_order_created',
      entity: 'deal',
      entityId: 'd-1',
      after: { orderId: 'ord-1', organizationId: 'org-1' }
    });
  });
});
