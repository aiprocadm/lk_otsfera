/**
 * Этап 5 (PR-1) — сервис каталога услуг и цен (`У-136`, решение `Р-13`):
 * гейты ролей и граница компании (сравнение, а не подмена), валидация и
 * нормализация цены/НДС, P2002-дубль артикула → duplicate_code, аудит
 * создания/правки/деактивации, идемпотентность переключателя активности.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAuditMock } = vi.hoisted(() => ({ recordAuditMock: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));

import {
  createCatalogItem,
  listCatalogItems,
  setCatalogItemActive,
  updateCatalogItem,
  type CatalogItemInput,
} from '@/lib/services/admin/catalogItems';

const P2002 = new Prisma.PrismaClientKnownRequestError('dup', {
  code: 'P2002',
  clientVersion: '5.0.0',
});

const adminSession = (): SessionPayload =>
  ({ sub: 'a1', role: 'admin' }) as unknown as SessionPayload;
const leaderSession = (companyId = 'co-1'): SessionPayload =>
  ({ sub: 'l1', role: 'leader', companyId }) as unknown as SessionPayload;
const managerSession = (): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-1' }) as unknown as SessionPayload;

/** Строка из БД под ROW_SELECT: у number есть toFixed/toString — как у Decimal. */
const dbRow = (over: Record<string, unknown> = {}) => ({
  id: 'ci-1',
  name: 'Обучение по охране труда',
  code: 'OT-101',
  unit: 'person',
  price: 100,
  vatRate: null,
  vatIncluded: true,
  directionId: null,
  direction: null,
  description: null,
  isActive: true,
  sortOrder: 0,
  companyId: 'co-1',
  ...over,
});

function fake(over: { rows?: unknown[]; row?: unknown } = {}) {
  const findMany = vi.fn().mockResolvedValue(over.rows ?? []);
  const count = vi.fn().mockResolvedValue((over.rows ?? []).length);
  const findUnique = vi.fn().mockResolvedValue(over.row ?? null);
  const create = vi.fn().mockResolvedValue({ id: 'ci-new' });
  const update = vi.fn().mockResolvedValue({});
  return {
    prisma: { catalogItem: { findMany, count, findUnique, create, update } } as unknown as PrismaClient,
    findMany,
    count,
    findUnique,
    create,
    update,
  };
}

const VALID: CatalogItemInput = {
  name: 'Обучение по охране труда',
  code: 'OT-101',
  unit: 'person',
  price: '1 234,56',
  vatRate: '0.2',
  vatIncluded: true,
  directionId: null,
  description: null,
  sortOrder: 10,
};

beforeEach(() => recordAuditMock.mockReset());

describe('listCatalogItems — гейты и скоуп', () => {
  it('admin читает любую компанию; leader — только свою; manager — forbidden без запроса', async () => {
    const { prisma, findMany } = fake();
    expect((await listCatalogItems(prisma, adminSession(), { companyId: 'co-2' })).ok).toBe(true);
    expect((await listCatalogItems(prisma, leaderSession(), { companyId: 'co-1' })).ok).toBe(true);

    const denied = fake();
    expect(
      await listCatalogItems(denied.prisma, leaderSession(), { companyId: 'co-2' })
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(
      await listCatalogItems(denied.prisma, managerSession(), { companyId: 'co-1' })
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(denied.findMany).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('маппинг строк: цена фиксированной точности, обе ветки НДС и направления', async () => {
    const { prisma } = fake({
      rows: [
        dbRow(),
        dbRow({
          id: 'ci-2',
          vatRate: 0.2,
          direction: { name: 'Охрана труда' },
          directionId: 'dir-1',
          description: 'Курс 40 часов',
        }),
      ],
    });
    const res = await listCatalogItems(prisma, adminSession(), { companyId: 'co-1' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.items[0]).toMatchObject({ price: '100.00', vatRate: null, directionName: null });
    expect(res.items[1]).toMatchObject({
      price: '100.00',
      vatRate: '0.2',
      directionName: 'Охрана труда',
      description: 'Курс 40 часов',
    });
  });

  it('q строит OR-фильтр по имени и артикулу; пробельный q — нет', async () => {
    const withQ = fake();
    await listCatalogItems(withQ.prisma, adminSession(), { companyId: 'co-1', q: ' огне ' });
    expect(withQ.findMany.mock.calls[0]![0].where.OR).toEqual([
      { name: { contains: 'огне', mode: 'insensitive' } },
      { code: { contains: 'огне', mode: 'insensitive' } },
    ]);

    const blank = fake();
    await listCatalogItems(blank.prisma, adminSession(), { companyId: 'co-1', q: '   ' });
    expect(blank.findMany.mock.calls[0]![0].where.OR).toBeUndefined();
  });

  it('по умолчанию только активные; includeInactive снимает фильтр', async () => {
    const active = fake();
    await listCatalogItems(active.prisma, adminSession(), { companyId: 'co-1' });
    expect(active.findMany.mock.calls[0]![0].where.isActive).toBe(true);

    const all = fake();
    await listCatalogItems(all.prisma, adminSession(), {
      companyId: 'co-1',
      includeInactive: true,
    });
    expect(all.findMany.mock.calls[0]![0].where.isActive).toBeUndefined();
  });
});

describe('createCatalogItem — валидация и нормализация', () => {
  it('гейты: manager → forbidden, leader чужая компания → forbidden, БД не трогаем', async () => {
    const { prisma, create } = fake();
    expect(await createCatalogItem(prisma, managerSession(), 'co-1', VALID)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await createCatalogItem(prisma, leaderSession(), 'co-2', VALID)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('кривой ввод → validation со всеми причинами, запись и аудит не идут', async () => {
    const { prisma, create } = fake();
    const res = await createCatalogItem(prisma, adminSession(), 'co-1', {
      ...VALID,
      name: '  ',
      code: 'x'.repeat(65),
      price: '12.345',
      vatRate: '0.15',
      description: 'д'.repeat(2001),
      sortOrder: -1,
    });
    expect(res).toEqual({
      ok: false,
      error: 'validation',
      messages: [
        'Название: от 1 до 300 символов',
        'Артикул: от 1 до 64 символов',
        'Цена: неотрицательное число, максимум две цифры после запятой',
        'Ставка НДС: 0%, 5%, 7%, 10%, 20% или «не облагается»',
        'Описание: до 2000 символов',
        'Порядок: целое число от 0 до 100000',
      ],
    });
    expect(create).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it('вторые ветки границ: длинное имя, пустой артикул, «1e5», дробный порядок', async () => {
    const { prisma } = fake();
    const res = await createCatalogItem(prisma, adminSession(), 'co-1', {
      ...VALID,
      name: 'н'.repeat(301),
      code: '',
      price: '1e5',
      vatRate: null,
      sortOrder: 1.5,
    });
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    if (res.ok) return;
    expect(res.error === 'validation' && res.messages).toEqual([
      'Название: от 1 до 300 символов',
      'Артикул: от 1 до 64 символов',
      'Цена: неотрицательное число, максимум две цифры после запятой',
      'Порядок: целое число от 0 до 100000',
    ]);
  });

  it('цена сверх потолка и порядок сверх 100000 — тоже отказ', async () => {
    const { prisma } = fake();
    const res = await createCatalogItem(prisma, adminSession(), 'co-1', {
      ...VALID,
      price: '9999999999999.99',
      sortOrder: 100_001,
    });
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    if (res.ok) return;
    expect(res.error === 'validation' && res.messages).toEqual([
      'Цена: неотрицательное число, максимум две цифры после запятой',
      'Порядок: целое число от 0 до 100000',
    ]);
  });

  it('нормализация: «1 234,56» → 1234.56, НДС 0.2 → 0.2000, трим полей, аудит создания', async () => {
    const { prisma, create } = fake();
    const res = await createCatalogItem(prisma, leaderSession(), 'co-1', {
      ...VALID,
      name: '  Обучение  ',
      code: ' OT-101 ',
      description: '   ',
    });
    expect(res).toEqual({ ok: true, id: 'ci-new' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'co-1',
          name: 'Обучение',
          code: 'OT-101',
          price: '1234.56',
          vatRate: '0.2000',
          description: null,
        }),
      })
    );
    const audit = recordAuditMock.mock.calls[0]![1];
    expect(audit.action).toBe('catalog_item_created');
    expect(audit.entityId).toBe('ci-new');
    // Ключ `article`, не `code`: диалог диффа аудита маскирует поля по имени
    // `code` (защита bridge-кодов), а артикул — не секрет.
    expect(audit.after).toEqual({
      name: 'Обучение',
      article: 'OT-101',
      price: '1234.56',
      vatRate: '0.2000',
    });
  });

  it('P2002 (дубль артикула) → duplicate_code без аудита; прочие ошибки пробрасываются', async () => {
    const dup = fake();
    dup.create.mockRejectedValue(P2002);
    expect(await createCatalogItem(dup.prisma, adminSession(), 'co-1', VALID)).toEqual({
      ok: false,
      error: 'duplicate_code',
    });
    expect(recordAuditMock).not.toHaveBeenCalled();

    const broken = fake();
    broken.create.mockRejectedValue(new Error('connection reset'));
    await expect(createCatalogItem(broken.prisma, adminSession(), 'co-1', VALID)).rejects.toThrow(
      'connection reset'
    );
  });

  it('не-объектные и не-P2002 отказы БД не маскируются под дубль', async () => {
    // isUniqueViolation по веткам: строка, null и объект с другим кодом —
    // всё это сбой хранилища, он обязан дойти до мониторинга как есть.
    const str = fake();
    str.create.mockRejectedValue('boom');
    await expect(createCatalogItem(str.prisma, adminSession(), 'co-1', VALID)).rejects.toBe('boom');

    const nul = fake();
    nul.create.mockRejectedValue(null);
    await expect(createCatalogItem(nul.prisma, adminSession(), 'co-1', VALID)).rejects.toBeNull();

    // P2003 (битый FK: подделанный directionId) — ошибка формы, не 500.
    const fk = fake();
    fk.create.mockRejectedValue({ code: 'P2003' });
    expect(await createCatalogItem(fk.prisma, adminSession(), 'co-1', VALID)).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Направление не найдено'],
    });

    const other = fake();
    other.create.mockRejectedValue({ code: 'P2025' });
    await expect(createCatalogItem(other.prisma, adminSession(), 'co-1', VALID)).rejects.toEqual({
      code: 'P2025',
    });
  });
});

describe('updateCatalogItem', () => {
  it('manager → forbidden до запроса; нет записи → not_found; leader чужой компании → forbidden', async () => {
    const { prisma, findUnique } = fake();
    expect(await updateCatalogItem(prisma, managerSession(), 'ci-1', VALID)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(findUnique).not.toHaveBeenCalled();

    expect(await updateCatalogItem(prisma, adminSession(), 'ci-X', VALID)).toEqual({
      ok: false,
      error: 'not_found',
    });

    const alien = fake({ row: dbRow({ companyId: 'co-2' }) });
    expect(await updateCatalogItem(alien.prisma, leaderSession(), 'ci-1', VALID)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(alien.update).not.toHaveBeenCalled();
  });

  it('кривой ввод → validation, запись не идёт', async () => {
    const { prisma, update } = fake({ row: dbRow() });
    const res = await updateCatalogItem(prisma, adminSession(), 'ci-1', { ...VALID, price: 'x' });
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(update).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it('успех пишет и аудирует catalog_item_updated с before/after, где видна цена', async () => {
    const { prisma, update } = fake({ row: dbRow() });
    const res = await updateCatalogItem(prisma, leaderSession(), 'ci-1', {
      ...VALID,
      price: '5 000,00',
      vatRate: '0',
    });
    expect(res).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ci-1' },
        data: expect.objectContaining({ price: '5000.00', vatRate: '0.0000' }),
      })
    );
    const audit = recordAuditMock.mock.calls[0]![1];
    expect(audit.action).toBe('catalog_item_updated');
    expect(audit.entityId).toBe('ci-1');
    // История изменений цены (`У-136`): старая и новая цена лежат рядом.
    expect(audit.before.price).toBe('100.00');
    expect(audit.after.price).toBe('5000.00');
    expect(audit.before.vatRate).toBeNull();
    expect(audit.after.vatRate).toBe('0.0000');
  });

  it('P2002 → duplicate_code без аудита; не-P2002 пробрасывается', async () => {
    const dup = fake({ row: dbRow() });
    dup.update.mockRejectedValue(P2002);
    expect(await updateCatalogItem(dup.prisma, adminSession(), 'ci-1', VALID)).toEqual({
      ok: false,
      error: 'duplicate_code',
    });
    expect(recordAuditMock).not.toHaveBeenCalled();

    const broken = fake({ row: dbRow() });
    broken.update.mockRejectedValue(new Error('connection reset'));
    await expect(updateCatalogItem(broken.prisma, adminSession(), 'ci-1', VALID)).rejects.toThrow(
      'connection reset'
    );
  });
});

describe('setCatalogItemActive', () => {
  it('manager → forbidden до запроса; нет записи → not_found; leader чужой компании → forbidden', async () => {
    const { prisma, findUnique } = fake();
    expect(await setCatalogItemActive(prisma, managerSession(), 'ci-1', false)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(findUnique).not.toHaveBeenCalled();

    expect(await setCatalogItemActive(prisma, adminSession(), 'ci-X', false)).toEqual({
      ok: false,
      error: 'not_found',
    });

    const alien = fake({ row: { companyId: 'co-2', isActive: true } });
    expect(await setCatalogItemActive(alien.prisma, leaderSession(), 'ci-1', false)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(alien.update).not.toHaveBeenCalled();
  });

  it('идемпотентность: то же состояние — ok без записи и без аудита', async () => {
    const { prisma, update } = fake({ row: { companyId: 'co-1', isActive: true } });
    expect(await setCatalogItemActive(prisma, leaderSession(), 'ci-1', true)).toEqual({ ok: true });
    expect(update).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it('деактивация пишет isActive=false и аудит catalog_item_deactivated', async () => {
    const { prisma, update } = fake({ row: { companyId: 'co-1', isActive: true } });
    expect(await setCatalogItemActive(prisma, adminSession(), 'ci-1', false)).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ where: { id: 'ci-1' }, data: { isActive: false } });
    expect(recordAuditMock.mock.calls[0]![1]).toMatchObject({
      action: 'catalog_item_deactivated',
      entity: 'catalog_item',
      entityId: 'ci-1',
    });
  });

  it('активация обратно пишет catalog_item_activated', async () => {
    const { prisma, update } = fake({ row: { companyId: 'co-1', isActive: false } });
    expect(await setCatalogItemActive(prisma, leaderSession(), 'ci-1', true)).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ where: { id: 'ci-1' }, data: { isActive: true } });
    expect(recordAuditMock.mock.calls[0]![1].action).toBe('catalog_item_activated');
  });
});
