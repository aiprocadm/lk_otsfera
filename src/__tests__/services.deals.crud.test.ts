/**
 * Unit-тесты src/lib/services/deals/crud.ts (этап 6) на prisma-моке.
 *
 *   - createDeal: гейты (клиент, staff без companyId), валидация (title/amount/
 *     date + склейка сообщений), организация чужой компании → forbidden (admin —
 *     любая), ответственный: дефолт sub / чужая компания / неактивный;
 *   - updateDeal: not_found вне скоупа, завершённая → validation, happy-path;
 *   - аудит deal_created / deal_updated.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { createDeal, updateDeal } from '@/lib/services/deals/crud';

// ─── helpers ──────────────────────────────────────────────────────────────────

const ADMIN: SessionPayload = { sub: 'adm-1', role: 'admin', companyId: 'c1' };
const MGR: SessionPayload = { sub: 'm-1', role: 'manager', companyId: 'c1' };
const PARTNER: SessionPayload = { sub: 'p-1', role: 'partner', partnerId: 'pt-1' };

type Mocks = {
  orgFindUnique: ReturnType<typeof vi.fn>;
  userFindUnique: ReturnType<typeof vi.fn>;
  dealCreate: ReturnType<typeof vi.fn>;
  dealFindFirst: ReturnType<typeof vi.fn>;
  dealUpdate: ReturnType<typeof vi.fn>;
};

function makePrisma(
  opts: { org?: unknown; candidate?: unknown; existing?: unknown } = {}
): { prisma: PrismaClient } & Mocks {
  const orgFindUnique = vi.fn().mockResolvedValue(opts.org ?? null);
  const userFindUnique = vi.fn().mockResolvedValue(opts.candidate ?? null);
  const dealCreate = vi.fn().mockImplementation(async ({ data }) => ({ id: 'd-new', ...data }));
  const dealFindFirst = vi.fn().mockResolvedValue(opts.existing ?? null);
  const dealUpdate = vi.fn().mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
  const prisma = {
    organization: { findUnique: orgFindUnique },
    user: { findUnique: userFindUnique },
    deal: { create: dealCreate, findFirst: dealFindFirst, update: dealUpdate }
  } as unknown as PrismaClient;
  return { prisma, orgFindUnique, userFindUnique, dealCreate, dealFindFirst, dealUpdate };
}

const VALID = { title: 'Поставка обучения' };

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── createDeal — гейты ───────────────────────────────────────────────────────

describe('createDeal — гейты', () => {
  it('клиентская роль → forbidden без запросов', async () => {
    const { prisma, dealCreate } = makePrisma();
    expect(await createDeal(prisma, PARTNER, VALID)).toEqual({ ok: false, error: 'forbidden' });
    expect(dealCreate).not.toHaveBeenCalled();
  });

  it('staff без companyId → forbidden (сделке нужна граница C8)', async () => {
    const { prisma } = makePrisma();
    expect(await createDeal(prisma, { sub: 'adm-0', role: 'admin' }, VALID)).toEqual({
      ok: false,
      error: 'forbidden'
    });
  });
});

// ─── createDeal — валидация ───────────────────────────────────────────────────

describe('createDeal — валидация входа', () => {
  it('пустой/пробельный title → validation', async () => {
    const { prisma } = makePrisma();
    expect(await createDeal(prisma, MGR, { title: '   ' })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Укажите название сделки']
    });
  });

  it('кривая сумма → validation', async () => {
    const { prisma } = makePrisma();
    expect(await createDeal(prisma, MGR, { title: 'X', amount: '12.345' })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Сумма — число, до двух знаков после запятой']
    });
  });

  it('кривая дата → validation', async () => {
    const { prisma } = makePrisma();
    expect(await createDeal(prisma, MGR, { title: 'X', expectedCloseAt: '01.09.2026' })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Некорректная дата закрытия']
    });
  });

  it('несколько ошибок склеиваются в один список (title+amount+date)', async () => {
    const { prisma } = makePrisma();
    expect(
      await createDeal(prisma, MGR, { title: '', amount: 'abc', expectedCloseAt: 'завтра' })
    ).toEqual({
      ok: false,
      error: 'validation',
      messages: [
        'Укажите название сделки',
        'Сумма — число, до двух знаков после запятой',
        'Некорректная дата закрытия'
      ]
    });
  });

  it('запятая в сумме нормализуется, дата — полночь UTC', async () => {
    const { prisma, dealCreate } = makePrisma();
    const res = await createDeal(prisma, MGR, {
      title: '  Сделка  ',
      amount: '1500,50',
      expectedCloseAt: '2026-09-01'
    });
    expect(res.ok).toBe(true);
    expect(dealCreate).toHaveBeenCalledWith({
      data: {
        companyId: 'c1',
        title: 'Сделка',
        amount: '1500.50',
        expectedCloseAt: new Date('2026-09-01T00:00:00.000Z'),
        organizationId: null,
        managerId: 'm-1'
      }
    });
  });
});

// ─── createDeal — организация ─────────────────────────────────────────────────

describe('createDeal — организация', () => {
  it('организация чужой компании → forbidden для менеджера', async () => {
    const { prisma } = makePrisma({ org: { companyId: 'c2' } });
    expect(await createDeal(prisma, MGR, { ...VALID, organizationId: 'org-alien' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
  });

  it('несуществующая организация → forbidden', async () => {
    const { prisma } = makePrisma({ org: null });
    expect(await createDeal(prisma, MGR, { ...VALID, organizationId: 'org-ghost' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
  });

  it('admin может привязать организацию любой компании', async () => {
    const { prisma, dealCreate } = makePrisma({ org: { companyId: 'c2' } });
    const res = await createDeal(prisma, ADMIN, { ...VALID, organizationId: 'org-2' });
    expect(res.ok).toBe(true);
    expect(dealCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-2', companyId: 'c1' }) })
    );
  });
});

// ─── createDeal — ответственный менеджер ──────────────────────────────────────

describe('createDeal — ответственный менеджер', () => {
  it('managerId не передан → дефолт sub сессии, кандидата в БД не ищем', async () => {
    const { prisma, userFindUnique, dealCreate } = makePrisma();
    const res = await createDeal(prisma, MGR, VALID);
    expect(res.ok).toBe(true);
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(dealCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ managerId: 'm-1' }) })
    );
  });

  it('менеджер чужой компании → validation «не найден»', async () => {
    const { prisma } = makePrisma({ candidate: { role: 'manager', isActive: true, companyId: 'c2' } });
    expect(await createDeal(prisma, MGR, { ...VALID, managerId: 'm-alien' })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Ответственный менеджер не найден']
    });
  });

  it('неактивный менеджер → validation (даже для admin)', async () => {
    const { prisma } = makePrisma({ candidate: { role: 'manager', isActive: false, companyId: 'c1' } });
    expect(await createDeal(prisma, ADMIN, { ...VALID, managerId: 'm-off' })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Ответственный менеджер не найден']
    });
  });

  it('кандидат не manager-роли → validation', async () => {
    const { prisma } = makePrisma({ candidate: { role: 'partner', isActive: true, companyId: 'c1' } });
    expect(await createDeal(prisma, MGR, { ...VALID, managerId: 'u-partner' })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Ответственный менеджер не найден']
    });
  });

  it('happy: активный менеджер своей компании + аудит deal_created', async () => {
    const { prisma, dealCreate } = makePrisma({
      candidate: { role: 'manager', isActive: true, companyId: 'c1' }
    });
    const res = await createDeal(prisma, MGR, { ...VALID, organizationId: '', managerId: 'm-2' });
    expect(res.ok).toBe(true);
    expect(dealCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ managerId: 'm-2', organizationId: null }) })
    );
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'm-1',
      action: 'deal_created',
      entity: 'deal',
      entityId: 'd-new',
      after: { organizationId: null, managerId: 'm-2' }
    });
  });
});

// ─── updateDeal ───────────────────────────────────────────────────────────────

describe('updateDeal', () => {
  it('клиентская роль → forbidden', async () => {
    const { prisma } = makePrisma();
    expect(await updateDeal(prisma, PARTNER, { dealId: 'd-1', ...VALID })).toEqual({
      ok: false,
      error: 'forbidden'
    });
  });

  it('сделка вне скоупа → not_found (скоуп в самой выборке)', async () => {
    const { prisma, dealFindFirst } = makePrisma({ existing: null });
    expect(await updateDeal(prisma, MGR, { dealId: 'd-alien', ...VALID })).toEqual({
      ok: false,
      error: 'not_found'
    });
    expect(dealFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ id: 'd-alien' }, { companyId: 'c1', managerId: 'm-1' }] }
      })
    );
  });

  it('завершённая сделка (won) → validation, update не вызывается', async () => {
    const { prisma, dealUpdate } = makePrisma({ existing: { id: 'd-1', status: 'won' } });
    expect(await updateDeal(prisma, MGR, { dealId: 'd-1', ...VALID })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Завершённую сделку нельзя редактировать']
    });
    expect(dealUpdate).not.toHaveBeenCalled();
  });

  it('кривой вход на открытой сделке → validation (после скоуп-проверки)', async () => {
    const { prisma } = makePrisma({ existing: { id: 'd-1', status: 'open' } });
    expect(await updateDeal(prisma, MGR, { dealId: 'd-1', title: ' ' })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Укажите название сделки']
    });
  });

  it('happy: поля перезаписываются + аудит deal_updated', async () => {
    const { prisma, dealUpdate } = makePrisma({ existing: { id: 'd-1', status: 'open' } });
    const res = await updateDeal(prisma, MGR, {
      dealId: 'd-1',
      title: 'Новое имя',
      amount: '99',
      expectedCloseAt: '2026-10-15'
    });
    expect(res.ok).toBe(true);
    expect(dealUpdate).toHaveBeenCalledWith({
      where: { id: 'd-1' },
      data: {
        title: 'Новое имя',
        amount: '99',
        expectedCloseAt: new Date('2026-10-15T00:00:00.000Z'),
        organizationId: null,
        managerId: 'm-1'
      }
    });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'm-1',
      action: 'deal_updated',
      entity: 'deal',
      entityId: 'd-1',
      after: { organizationId: null, managerId: 'm-1' }
    });
  });
});
