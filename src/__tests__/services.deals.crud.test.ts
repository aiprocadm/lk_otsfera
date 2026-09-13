/**
 * Unit-тесты src/lib/services/deals/crud.ts (этап 6) на prisma-моке.
 *
 *   - createDeal: гейты (клиент, staff без companyId), валидация (title/amount/
 *     date + склейка сообщений), организация чужой компании → forbidden (admin —
 *     любая), ответственный: дефолт sub / чужая компания / неактивный;
 *   - updateDeal: not_found вне скоупа, завершённая → validation, happy-path;
 *   - аудит deal_created / deal_updated;
 *   - `У-180` контакт сделки: не найден / архив / чужая компания / организация
 *     не совпадает → validation с точным сообщением; «с улицы», сделка без
 *     организации и совпадающая организация — ok; компания при правке берётся
 *     из сделки, а не из сессии.
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
  contactFindUnique: ReturnType<typeof vi.fn>;
};

function makePrisma(
  opts: { org?: unknown; candidate?: unknown; existing?: unknown; contact?: unknown } = {}
): { prisma: PrismaClient } & Mocks {
  const orgFindUnique = vi.fn().mockResolvedValue(opts.org ?? null);
  const userFindUnique = vi.fn().mockResolvedValue(opts.candidate ?? null);
  const dealCreate = vi.fn().mockImplementation(async ({ data }) => ({ id: 'd-new', ...data }));
  const dealFindFirst = vi.fn().mockResolvedValue(opts.existing ?? null);
  const dealUpdate = vi
    .fn()
    .mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
  const contactFindUnique = vi.fn().mockResolvedValue(opts.contact ?? null);
  const prisma = {
    organization: { findUnique: orgFindUnique },
    user: { findUnique: userFindUnique },
    deal: { create: dealCreate, findFirst: dealFindFirst, update: dealUpdate },
    contact: { findUnique: contactFindUnique },
  } as unknown as PrismaClient;
  return {
    prisma,
    orgFindUnique,
    userFindUnique,
    dealCreate,
    dealFindFirst,
    dealUpdate,
    contactFindUnique,
  };
}

const CONTACT_MISMATCH = 'Контакт не найден или относится к другой организации';

/** Живой контакт компании c1 без организации («с улицы»). */
function contact(over: Record<string, unknown> = {}) {
  return { companyId: 'c1', organizationId: null, isArchived: false, ...over };
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

  it('название вообще не передано → validation, а не падение', async () => {
    // Сделку заводят и через API с сырым JSON: поле может отсутствовать.
    const { prisma, dealCreate } = makePrisma();
    expect(await createDeal(prisma, MGR, {} as never)).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Укажите название сделки'],
    });
    expect(dealCreate).not.toHaveBeenCalled();
  });

  it('staff без companyId → forbidden (сделке нужна граница C8)', async () => {
    const { prisma } = makePrisma();
    expect(await createDeal(prisma, { sub: 'adm-0', role: 'admin' }, VALID)).toEqual({
      ok: false,
      error: 'forbidden',
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
      messages: ['Укажите название сделки'],
    });
  });

  it('кривая сумма → validation', async () => {
    const { prisma } = makePrisma();
    expect(await createDeal(prisma, MGR, { title: 'X', amount: '12.345' })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Сумма — число, до двух знаков после запятой'],
    });
  });

  it('кривая дата → validation', async () => {
    const { prisma } = makePrisma();
    expect(await createDeal(prisma, MGR, { title: 'X', expectedCloseAt: '01.09.2026' })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Некорректная дата закрытия'],
    });
  });

  it('несуществующий день не «переезжает» на следующий месяц', async () => {
    // «2026-02-30» проходит и шаблон, и проверку на Invalid Date — JS отдаёт
    // 2 марта. Сделка получила бы срок, которого человек не ставил.
    const { prisma } = makePrisma();
    for (const bad of ['2026-02-30', '2026-04-31', '2026-02-29']) {
      expect(
        await createDeal(prisma, MGR, { title: 'X', expectedCloseAt: bad }),
        bad
      ).toMatchObject({ ok: false, error: 'validation' });
    }
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
        'Некорректная дата закрытия',
      ],
    });
  });

  it('запятая в сумме нормализуется, дата — полночь UTC', async () => {
    const { prisma, dealCreate } = makePrisma();
    const res = await createDeal(prisma, MGR, {
      title: '  Сделка  ',
      amount: '1500,50',
      expectedCloseAt: '2026-09-01',
    });
    expect(res.ok).toBe(true);
    expect(dealCreate).toHaveBeenCalledWith({
      data: {
        companyId: 'c1',
        title: 'Сделка',
        amount: '1500.50',
        expectedCloseAt: new Date('2026-09-01T00:00:00.000Z'),
        organizationId: null,
        managerId: 'm-1',
        contactId: null,
      },
    });
  });
});

// ─── createDeal — организация ─────────────────────────────────────────────────

describe('createDeal — организация', () => {
  it('организация чужой компании → forbidden для менеджера', async () => {
    const { prisma } = makePrisma({ org: { companyId: 'c2' } });
    expect(await createDeal(prisma, MGR, { ...VALID, organizationId: 'org-alien' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('несуществующая организация → forbidden', async () => {
    const { prisma } = makePrisma({ org: null });
    expect(await createDeal(prisma, MGR, { ...VALID, organizationId: 'org-ghost' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('admin может привязать организацию любой компании', async () => {
    const { prisma, dealCreate } = makePrisma({ org: { companyId: 'c2' } });
    const res = await createDeal(prisma, ADMIN, { ...VALID, organizationId: 'org-2' });
    expect(res.ok).toBe(true);
    expect(dealCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org-2', companyId: 'c1' }),
      })
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
    const { prisma } = makePrisma({
      candidate: { role: 'manager', isActive: true, companyId: 'c2' },
    });
    expect(await createDeal(prisma, MGR, { ...VALID, managerId: 'm-alien' })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Ответственный менеджер не найден'],
    });
  });

  it('неактивный менеджер → validation (даже для admin)', async () => {
    const { prisma } = makePrisma({
      candidate: { role: 'manager', isActive: false, companyId: 'c1' },
    });
    expect(await createDeal(prisma, ADMIN, { ...VALID, managerId: 'm-off' })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Ответственный менеджер не найден'],
    });
  });

  it('кандидат не manager-роли → validation', async () => {
    const { prisma } = makePrisma({
      candidate: { role: 'partner', isActive: true, companyId: 'c1' },
    });
    expect(await createDeal(prisma, MGR, { ...VALID, managerId: 'u-partner' })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Ответственный менеджер не найден'],
    });
  });

  it('кандидат с ролью leader валиден (контур Р-Л-4, ТЗ 2026-08-17)', async () => {
    const { prisma } = makePrisma({
      candidate: { role: 'leader', isActive: true, companyId: 'c1' },
    });
    const res = await createDeal(prisma, MGR, { ...VALID, managerId: 'ldr-1' });
    expect(res.ok).toBe(true);
  });

  it('happy: активный менеджер своей компании + аудит deal_created', async () => {
    const { prisma, dealCreate } = makePrisma({
      candidate: { role: 'manager', isActive: true, companyId: 'c1' },
    });
    const res = await createDeal(prisma, MGR, { ...VALID, organizationId: '', managerId: 'm-2' });
    expect(res.ok).toBe(true);
    expect(dealCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ managerId: 'm-2', organizationId: null }),
      })
    );
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'm-1',
      action: 'deal_created',
      entity: 'deal',
      entityId: 'd-new',
      after: { organizationId: null, managerId: 'm-2', contactId: null },
    });
  });
});

// ─── createDeal — контакт сделки (`У-180`) ────────────────────────────────────

describe('createDeal — контакт сделки (`У-180`)', () => {
  it('contactId не передан, пустой или пробельный → контакт не ищем, в data и аудите contactId: null', async () => {
    // «Ключа нет» и «ключ = null/пустой» — четыре разных входа с одним итогом
    // (exactOptionalPropertyTypes: undefined в ключ не положить — ключ опускаем).
    const inputs = [{}, { contactId: null }, { contactId: '' }, { contactId: '   ' }];
    for (const extra of inputs) {
      const { prisma, contactFindUnique, dealCreate } = makePrisma();
      const res = await createDeal(prisma, MGR, { ...VALID, ...extra });
      expect(res.ok, JSON.stringify(extra)).toBe(true);
      expect(contactFindUnique).not.toHaveBeenCalled();
      expect(dealCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ contactId: null }) })
      );
    }
  });

  it('контакт ищется по id (после обрезки пробелов) с полями компании, организации и архива', async () => {
    const { prisma, contactFindUnique } = makePrisma({ contact: contact() });
    expect((await createDeal(prisma, MGR, { ...VALID, contactId: '  k1  ' })).ok).toBe(true);
    expect(contactFindUnique).toHaveBeenCalledWith({
      where: { id: 'k1' },
      select: { companyId: true, organizationId: true, isArchived: true },
    });
  });

  it.each([
    ['контакт не найден', null, undefined],
    ['контакт в архиве', contact({ isArchived: true }), undefined],
    ['контакт другой компании', contact({ companyId: 'c2' }), undefined],
    [
      'организация контакта не совпадает с организацией сделки',
      contact({ organizationId: 'org-2' }),
      'org-1',
    ],
  ])('%s → validation с точным сообщением, сделка не создаётся', async (_name, c, orgId) => {
    const { prisma, dealCreate } = makePrisma({ contact: c, org: { companyId: 'c1' } });
    expect(
      await createDeal(prisma, MGR, { ...VALID, contactId: 'k1', organizationId: orgId ?? null })
    ).toEqual({ ok: false, error: 'validation', messages: [CONTACT_MISMATCH] });
    expect(dealCreate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('admin: граница — компания сделки (из сессии), чужого контакта к ней не привязать', async () => {
    const { prisma, dealCreate } = makePrisma({ contact: contact({ companyId: 'c2' }) });
    expect(await createDeal(prisma, ADMIN, { ...VALID, contactId: 'k-alien' })).toEqual({
      ok: false,
      error: 'validation',
      messages: [CONTACT_MISMATCH],
    });
    expect(dealCreate).not.toHaveBeenCalled();
  });

  it('ok: контакт «с улицы» (без организации) при сделке с организацией', async () => {
    const { prisma, dealCreate } = makePrisma({ contact: contact(), org: { companyId: 'c1' } });
    const res = await createDeal(prisma, MGR, {
      ...VALID,
      contactId: 'k1',
      organizationId: 'org-1',
    });
    expect(res.ok).toBe(true);
    expect(dealCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org-1', contactId: 'k1' }),
      })
    );
  });

  it('ok: сделка без организации принимает любого контакта компании', async () => {
    const { prisma, dealCreate } = makePrisma({ contact: contact({ organizationId: 'org-2' }) });
    const res = await createDeal(prisma, MGR, { ...VALID, contactId: 'k1' });
    expect(res.ok).toBe(true);
    expect(dealCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: null, contactId: 'k1' }),
      })
    );
  });

  it('ok: организация контакта совпадает с организацией сделки + контакт в аудите', async () => {
    const { prisma, dealCreate } = makePrisma({
      contact: contact({ organizationId: 'org-1' }),
      org: { companyId: 'c1' },
    });
    const res = await createDeal(prisma, MGR, {
      ...VALID,
      contactId: 'k1',
      organizationId: 'org-1',
    });
    expect(res.ok).toBe(true);
    expect(dealCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org-1', contactId: 'k1' }),
      })
    );
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'm-1',
      action: 'deal_created',
      entity: 'deal',
      entityId: 'd-new',
      after: { organizationId: 'org-1', managerId: 'm-1', contactId: 'k1' },
    });
  });
});

// ─── updateDeal ───────────────────────────────────────────────────────────────

describe('updateDeal', () => {
  it('клиентская роль → forbidden', async () => {
    const { prisma } = makePrisma();
    expect(await updateDeal(prisma, PARTNER, { dealId: 'd-1', ...VALID })).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('сделка вне скоупа → not_found (скоуп в самой выборке)', async () => {
    const { prisma, dealFindFirst } = makePrisma({ existing: null });
    expect(await updateDeal(prisma, MGR, { dealId: 'd-alien', ...VALID })).toEqual({
      ok: false,
      error: 'not_found',
    });
    // `companyId` читается вместе со статусом: по нему проверяется контакт.
    expect(dealFindFirst).toHaveBeenCalledWith({
      where: { AND: [{ id: 'd-alien' }, { companyId: 'c1', managerId: 'm-1' }] },
      select: { id: true, status: true, companyId: true, contactId: true },
    });
  });

  it('завершённая сделка (won) → validation, update не вызывается', async () => {
    const { prisma, dealUpdate } = makePrisma({ existing: { id: 'd-1', status: 'won' } });
    expect(await updateDeal(prisma, MGR, { dealId: 'd-1', ...VALID })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Завершённую сделку нельзя редактировать'],
    });
    expect(dealUpdate).not.toHaveBeenCalled();
  });

  it('кривой вход на открытой сделке → validation (после скоуп-проверки)', async () => {
    const { prisma } = makePrisma({ existing: { id: 'd-1', status: 'open' } });
    expect(await updateDeal(prisma, MGR, { dealId: 'd-1', title: ' ' })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Укажите название сделки'],
    });
  });

  it('чужая организация при правке → forbidden, сделка не трогается', async () => {
    // Скоуп организации проверяется и на правке, а не только на создании: иначе
    // менеджер мог бы переподвесить свою сделку на чужую организацию.
    const { prisma, dealUpdate } = makePrisma({ existing: { id: 'd-1', status: 'open' } });
    expect(
      await updateDeal(prisma, MGR, { dealId: 'd-1', ...VALID, organizationId: 'org-alien' })
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(dealUpdate).not.toHaveBeenCalled();
  });

  it('ответственный не найден при правке → validation, сделка не трогается', async () => {
    const { prisma, dealUpdate } = makePrisma({
      existing: { id: 'd-1', status: 'open' },
      candidate: { role: 'manager', isActive: false, companyId: 'c1' },
    });
    expect(await updateDeal(prisma, MGR, { dealId: 'd-1', ...VALID, managerId: 'm-off' })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Ответственный менеджер не найден'],
    });
    expect(dealUpdate).not.toHaveBeenCalled();
  });

  it('happy: поля перезаписываются + аудит deal_updated', async () => {
    const { prisma, dealUpdate } = makePrisma({ existing: { id: 'd-1', status: 'open' } });
    const res = await updateDeal(prisma, MGR, {
      dealId: 'd-1',
      title: 'Новое имя',
      amount: '99',
      expectedCloseAt: '2026-10-15',
    });
    expect(res.ok).toBe(true);
    expect(dealUpdate).toHaveBeenCalledWith({
      where: { id: 'd-1' },
      data: {
        title: 'Новое имя',
        amount: '99',
        expectedCloseAt: new Date('2026-10-15T00:00:00.000Z'),
        organizationId: null,
        managerId: 'm-1',
        contactId: null,
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'm-1',
      action: 'deal_updated',
      entity: 'deal',
      entityId: 'd-1',
      after: { organizationId: null, managerId: 'm-1', contactId: null },
    });
  });
});

// ─── updateDeal — контакт сделки (`У-180`) ────────────────────────────────────

describe('updateDeal — контакт сделки (`У-180`)', () => {
  const OPEN = { id: 'd-1', status: 'open', companyId: 'c1' };

  it.each([
    ['контакт не найден', null, undefined],
    ['контакт в архиве', contact({ isArchived: true }), undefined],
    ['контакт другой компании', contact({ companyId: 'c2' }), undefined],
    [
      'организация контакта не совпадает с организацией сделки',
      contact({ organizationId: 'org-2' }),
      'org-1',
    ],
  ])('%s → validation с точным сообщением, сделка не трогается', async (_name, c, orgId) => {
    const { prisma, dealUpdate } = makePrisma({
      existing: OPEN,
      contact: c,
      org: { companyId: 'c1' },
    });
    expect(
      await updateDeal(prisma, MGR, {
        dealId: 'd-1',
        ...VALID,
        contactId: 'k1',
        organizationId: orgId ?? null,
      })
    ).toEqual({ ok: false, error: 'validation', messages: [CONTACT_MISMATCH] });
    expect(dealUpdate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('компания для проверки контакта берётся из СДЕЛКИ, а не из сессии (admin правит сделку компании c2)', async () => {
    // Admin видит сделки всех компаний (скоуп {}); контакт компании c2 к сделке
    // компании c2 подходит, хотя в сессии администратора компания c1.
    const { prisma, dealUpdate } = makePrisma({
      existing: { ...OPEN, companyId: 'c2' },
      contact: contact({ companyId: 'c2' }),
    });
    const res = await updateDeal(prisma, ADMIN, { dealId: 'd-1', ...VALID, contactId: 'k2' });
    expect(res.ok).toBe(true);
    expect(dealUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactId: 'k2' }) })
    );
    // И наоборот: контакт компании сессии (c1) к сделке компании c2 не подходит.
    const other = makePrisma({
      existing: { ...OPEN, companyId: 'c2' },
      contact: contact({ companyId: 'c1' }),
    });
    expect(
      await updateDeal(other.prisma, ADMIN, { dealId: 'd-1', ...VALID, contactId: 'k1' })
    ).toEqual({
      ok: false,
      error: 'validation',
      messages: [CONTACT_MISMATCH],
    });
  });

  it('ok: «с улицы» при сделке с организацией; любой контакт компании при сделке без организации; совпадающая организация', async () => {
    const cases: Array<[unknown, string | null]> = [
      [contact(), 'org-1'],
      [contact({ organizationId: 'org-2' }), null],
      [contact({ organizationId: 'org-1' }), 'org-1'],
    ];
    let lastPrisma: PrismaClient | undefined;
    for (const [c, orgId] of cases) {
      const { prisma, dealUpdate } = makePrisma({
        existing: OPEN,
        contact: c,
        org: { companyId: 'c1' },
      });
      lastPrisma = prisma;
      const res = await updateDeal(prisma, MGR, {
        dealId: 'd-1',
        ...VALID,
        contactId: 'k1',
        organizationId: orgId,
      });
      expect(res.ok, JSON.stringify(c)).toBe(true);
      expect(dealUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ organizationId: orgId, contactId: 'k1' }),
        })
      );
    }
    expect(recordAudit).toHaveBeenLastCalledWith(lastPrisma, {
      userId: 'm-1',
      action: 'deal_updated',
      entity: 'deal',
      entityId: 'd-1',
      after: { organizationId: 'org-1', managerId: 'm-1', contactId: 'k1' },
    });
  });

  it('прежний контакт сделки не перепроверяется: архивный остаётся, findUnique не зовётся', async () => {
    // Человек уехал в архив после привязки — правка названия сделки не должна
    // упираться в «контакт не найден»: значение не менялось, значит проверять
    // нечего. Новый контакт (другой id) проверяется как обычно.
    const { prisma, dealUpdate, contactFindUnique } = makePrisma({
      existing: { ...OPEN, contactId: 'k-old' },
      contact: null,
    });
    const res = await updateDeal(prisma, MGR, { dealId: 'd-1', ...VALID, contactId: ' k-old ' });
    expect(res.ok).toBe(true);
    expect(contactFindUnique).not.toHaveBeenCalled();
    expect(dealUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactId: 'k-old' }) })
    );

    const other = makePrisma({ existing: { ...OPEN, contactId: 'k-old' }, contact: null });
    expect(
      await updateDeal(other.prisma, MGR, { dealId: 'd-1', ...VALID, contactId: 'k-new' })
    ).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Контакт не найден или относится к другой организации'],
    });
    expect(other.contactFindUnique).toHaveBeenCalledTimes(1);
  });

  it('снятие контакта: contactId пустой → в data и аудите null, контакт не ищем', async () => {
    const { prisma, dealUpdate, contactFindUnique } = makePrisma({ existing: OPEN });
    const res = await updateDeal(prisma, MGR, { dealId: 'd-1', ...VALID, contactId: '' });
    expect(res.ok).toBe(true);
    expect(contactFindUnique).not.toHaveBeenCalled();
    expect(dealUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactId: null }) })
    );
  });
});
