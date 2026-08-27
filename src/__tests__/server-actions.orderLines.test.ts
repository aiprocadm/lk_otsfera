import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Этап 5 (`У-139`, `У-140`) — server-actions блока «Состав и стоимость».
 *
 * Проверяем ровно то, за что отвечает адаптер: гард сессии, разбор формы,
 * проброс аргументов в сервис, ревалидацию трёх кабинетов и то, что отказ
 * сервиса возвращается КАК ЕСТЬ (свой словарь ошибок в экшене — второй
 * источник правды, §3).
 */

const {
  requireSession,
  addOrderLine,
  updateOrderLine,
  removeOrderLine,
  setOrderTotalManually,
  recalcOrderTotal,
  buildLinesFromItems,
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  addOrderLine: vi.fn(),
  updateOrderLine: vi.fn(),
  removeOrderLine: vi.fn(),
  setOrderTotalManually: vi.fn(),
  recalcOrderTotal: vi.fn(),
  buildLinesFromItems: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { $mock: true } }));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/services/orders/orderLines', () => ({
  addOrderLine,
  updateOrderLine,
  removeOrderLine,
  setOrderTotalManually,
  recalcOrderTotal,
  buildLinesFromItems,
}));

import { revalidatePath } from 'next/cache';
import {
  addOrderLineAction,
  buildLinesFromItemsAction,
  recalcOrderTotalAction,
  removeOrderLineAction,
  setOrderTotalManuallyAction,
  updateOrderLineAction,
} from '@/server-actions/orders/lines';

const SESSION = { sub: 'm1', role: 'manager', companyId: 'co-1' };

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const FULL = {
  orderId: 'ord-1',
  catalogItemId: 'ci-1',
  title: 'Обучение по ОТ',
  quantity: '3',
  unit: 'piece',
  unitPrice: '1000,50',
  discountPercent: '10',
  vatRate: '0.2',
  vatIncluded: 'on',
  sortOrder: '2',
};

function paths(): string[] {
  return vi.mocked(revalidatePath).mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
  addOrderLine.mockResolvedValue({ ok: true, id: 'ol-1' });
  updateOrderLine.mockResolvedValue({ ok: true });
  removeOrderLine.mockResolvedValue({ ok: true });
  setOrderTotalManually.mockResolvedValue({ ok: true });
  recalcOrderTotal.mockResolvedValue({ ok: true });
  buildLinesFromItems.mockResolvedValue({ ok: true, created: 2, withoutPrice: [] });
});

describe('разбор формы строки', () => {
  it('форма целиком доезжает до сервиса без переработки чисел (нормализует сервис)', async () => {
    const res = await addOrderLineAction('ord-1', fd(FULL));
    expect(res).toEqual({ ok: true });
    expect(requireSession).toHaveBeenCalled();
    expect(addOrderLine).toHaveBeenCalledWith({ $mock: true }, SESSION, 'ord-1', {
      catalogItemId: 'ci-1',
      title: 'Обучение по ОТ',
      quantity: '3',
      unit: 'piece',
      unitPrice: '1000,50',
      discountPercent: '10',
      vatRate: '0.2',
      vatIncluded: true,
      sortOrder: 2,
    });
  });

  it('пустые поля: свободная строка без каталога, без скидки, «не облагается», без галочки НДС', async () => {
    await addOrderLineAction('ord-1', fd({ title: 'Свободная строка', quantity: '1' }));
    expect(addOrderLine.mock.calls[0]![3]).toMatchObject({
      catalogItemId: null,
      discountPercent: null,
      vatRate: null,
      vatIncluded: false,
      // Единица по умолчанию — «чел.», как в каталоге.
      unit: 'person',
      sortOrder: 0,
    });
  });

  it('подделанная единица измерения падает в «чел.», а не уходит в базу как есть', async () => {
    await addOrderLineAction('ord-1', fd({ ...FULL, unit: 'parrots' }));
    expect(addOrderLine.mock.calls[0]![3]).toMatchObject({ unit: 'person' });
  });

  it('«не облагается» из селекта приходит строкой none и превращается в null', async () => {
    await addOrderLineAction('ord-1', fd({ ...FULL, vatRate: 'none' }));
    expect(addOrderLine.mock.calls[0]![3]).toMatchObject({ vatRate: null });
  });
});

describe('ревалидация трёх кабинетов', () => {
  it('добавление освежает карточку заказа во всех трёх кабинетах', async () => {
    await addOrderLineAction('ord-1', fd(FULL));
    expect(paths()).toEqual([
      '/admin/orders/ord-1',
      '/leader/orders/ord-1',
      '/manager/orders/ord-1',
    ]);
  });

  it('правка берёт номер заказа из скрытого поля формы', async () => {
    const res = await updateOrderLineAction('ol-9', fd(FULL));
    expect(res).toEqual({ ok: true });
    expect(updateOrderLine).toHaveBeenCalledWith(
      { $mock: true },
      SESSION,
      'ol-9',
      expect.objectContaining({ title: 'Обучение по ОТ' })
    );
    expect(paths()).toEqual([
      '/admin/orders/ord-1',
      '/leader/orders/ord-1',
      '/manager/orders/ord-1',
    ]);
  });

  it('правка без номера заказа не зовёт сервис и не освежает пустой путь', async () => {
    const res = await updateOrderLineAction('ol-9', fd({ ...FULL, orderId: '' }));
    expect(res).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Нет идентификатора заказа'],
    });
    expect(updateOrderLine).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('удаление: сервису — строка, ревалидации — заказ', async () => {
    const res = await removeOrderLineAction('ol-9', 'ord-1');
    expect(res).toEqual({ ok: true });
    expect(removeOrderLine).toHaveBeenCalledWith({ $mock: true }, SESSION, 'ol-9');
    expect(paths()).toEqual([
      '/admin/orders/ord-1',
      '/leader/orders/ord-1',
      '/manager/orders/ord-1',
    ]);
  });
});

describe('сумма заказа', () => {
  it('ручная сумма уходит сырой строкой — разбор и проверка за сервисом', async () => {
    const res = await setOrderTotalManuallyAction('ord-1', fd({ totalAmount: '120 000,50' }));
    expect(res).toEqual({ ok: true });
    expect(setOrderTotalManually).toHaveBeenCalledWith(
      { $mock: true },
      SESSION,
      'ord-1',
      '120 000,50'
    );
    expect(paths()).toHaveLength(3);
  });

  it('пересчёт по строкам', async () => {
    const res = await recalcOrderTotalAction('ord-1');
    expect(res).toEqual({ ok: true });
    expect(recalcOrderTotal).toHaveBeenCalledWith({ $mock: true }, SESSION, 'ord-1');
    expect(paths()).toHaveLength(3);
  });
});

describe('сборка строк из позиций', () => {
  it('доносит до экрана и количество строк, и направления без цены', async () => {
    buildLinesFromItems.mockResolvedValue({
      ok: true,
      created: 3,
      withoutPrice: ['Пожарная безопасность'],
    });
    const res = await buildLinesFromItemsAction('ord-1');
    expect(res).toEqual({ ok: true, created: 3, withoutPrice: ['Пожарная безопасность'] });
    expect(paths()).toHaveLength(3);
  });

  it('отказ сервиса возвращается как есть и ничего не освежает', async () => {
    buildLinesFromItems.mockResolvedValue({
      ok: false,
      error: 'validation',
      messages: ['В заказе нет позиций — сначала добавьте слушателей.'],
    });
    const res = await buildLinesFromItemsAction('ord-1');
    expect(res).toEqual({
      ok: false,
      error: 'validation',
      messages: ['В заказе нет позиций — сначала добавьте слушателей.'],
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('отказ сервиса — код возвращается как есть', () => {
  it.each([
    ['add', () => addOrderLineAction('ord-1', fd(FULL)), addOrderLine],
    ['update', () => updateOrderLineAction('ol-9', fd(FULL)), updateOrderLine],
    ['remove', () => removeOrderLineAction('ol-9', 'ord-1'), removeOrderLine],
    ['total', () => setOrderTotalManuallyAction('ord-1', fd({ totalAmount: '1' })), setOrderTotalManually],
    ['recalc', () => recalcOrderTotalAction('ord-1'), recalcOrderTotal],
  ])('%s: заказ из 1С — order_from_1c без ревалидации', async (_name, call, service) => {
    service.mockResolvedValue({ ok: false, error: 'order_from_1c' });
    await expect(call()).resolves.toEqual({ ok: false, error: 'order_from_1c' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('validation с полевыми сообщениями доходит до формы целиком', async () => {
    addOrderLine.mockResolvedValue({
      ok: false,
      error: 'validation',
      messages: ['Количество: положительное число, максимум три знака после запятой'],
    });
    const res = await addOrderLineAction('ord-1', fd({ ...FULL, quantity: '0' }));
    expect(res).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Количество: положительное число, максимум три знака после запятой'],
    });
  });
});
