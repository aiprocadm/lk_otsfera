import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSettingsSection, createCatalogItem, updateCatalogItem, setCatalogItemActive } =
  vi.hoisted(() => ({
    requireSettingsSection: vi.fn(),
    createCatalogItem: vi.fn(),
    updateCatalogItem: vi.fn(),
    setCatalogItemActive: vi.fn(),
  }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));
vi.mock('@/lib/services/admin/catalogItems', async (orig) => {
  const actual = await orig<typeof import('@/lib/services/admin/catalogItems')>();
  return { ...actual, createCatalogItem, updateCatalogItem, setCatalogItemActive };
});

import { revalidatePath } from 'next/cache';
import {
  createCatalogItemAction,
  setCatalogItemActiveAction,
  updateCatalogItemAction,
} from '@/server-actions/admin/catalogItems';

/**
 * `У-136` — тонкие адаптеры каталога: гард раздела в КАЖДОМ действии
 * (`requireSettingsSection('catalogs.priceList', cabinet)` — найдено
 * адверсариальным ревью: requireSession-only пропускал руководителя с
 * default-deny профилем без `settings.catalogs.manage`, «скрытая карточка —
 * внешний вид, а не защита», §2b) + разбор формы.
 */
const LEADER = { sub: 'l1', role: 'leader', companyId: 'co-1' };

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSettingsSection.mockResolvedValue(LEADER);
  createCatalogItem.mockResolvedValue({ ok: true, id: 'ci-1' });
  updateCatalogItem.mockResolvedValue({ ok: true });
  setCatalogItemActive.mockResolvedValue({ ok: true });
});

describe('гард раздела — в каждом действии', () => {
  it('каждое действие спрашивает право catalogs.priceList своего кабинета', async () => {
    await createCatalogItemAction('leader', fd({ companyId: 'co-1', name: 'X' }));
    await updateCatalogItemAction('admin', fd({ id: 'ci-1', name: 'X' }));
    await setCatalogItemActiveAction('leader', fd({ id: 'ci-1', active: '1' }));
    expect(requireSettingsSection.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      ['catalogs.priceList', 'leader'],
      ['catalogs.priceList', 'admin'],
      ['catalogs.priceList', 'leader'],
    ]);
  });

  it('отказ гарда — до сервиса: профиль default-deny не долетает до мутации', async () => {
    requireSettingsSection.mockRejectedValue(new Error('REDIRECT:/forbidden'));
    await expect(createCatalogItemAction('leader', fd({ companyId: 'co-1' }))).rejects.toThrow(
      'REDIRECT:/forbidden'
    );
    await expect(updateCatalogItemAction('leader', fd({ id: 'ci-1' }))).rejects.toThrow(
      'REDIRECT:/forbidden'
    );
    await expect(
      setCatalogItemActiveAction('leader', fd({ id: 'ci-1', active: '0' }))
    ).rejects.toThrow('REDIRECT:/forbidden');
    expect(createCatalogItem).not.toHaveBeenCalled();
    expect(updateCatalogItem).not.toHaveBeenCalled();
    expect(setCatalogItemActive).not.toHaveBeenCalled();
  });
});

describe('разбор формы', () => {
  it('без companyId/id — validation, сервис не тронут', async () => {
    expect(await createCatalogItemAction('admin', fd({ name: 'X' }))).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Не выбрана компания'],
    });
    expect(await updateCatalogItemAction('admin', fd({ name: 'X' }))).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Нет идентификатора услуги'],
    });
    expect(await setCatalogItemActiveAction('admin', fd({ active: '1' }))).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Нет идентификатора услуги'],
    });
    expect(createCatalogItem).not.toHaveBeenCalled();
    expect(updateCatalogItem).not.toHaveBeenCalled();
  });

  it('поля формы: НДС none→null, чекбокс on, неизвестная единица → person', async () => {
    await createCatalogItemAction(
      'leader',
      fd({
        companyId: 'co-1',
        name: 'Обучение',
        code: 'OT-1',
        unit: 'взвод', // неизвестное значение из подделанной формы
        price: '100',
        vatRate: 'none',
        vatIncluded: 'on',
        directionId: '',
        sortOrder: '',
      })
    );
    expect(createCatalogItem).toHaveBeenCalledWith({}, LEADER, 'co-1', {
      name: 'Обучение',
      code: 'OT-1',
      unit: 'person',
      price: '100',
      vatRate: null,
      vatIncluded: true,
      directionId: null,
      description: null,
      sortOrder: 0,
    });
  });

  it('НДС долей и снятый чекбокс доезжают как есть; успех ревалидирует оба хаба', async () => {
    await updateCatalogItemAction(
      'admin',
      fd({ id: 'ci-1', name: 'X', code: 'A', unit: 'hour', price: '5', vatRate: '0.2' })
    );
    expect(updateCatalogItem).toHaveBeenCalledWith(
      {},
      LEADER,
      'ci-1',
      expect.objectContaining({ unit: 'hour', vatRate: '0.2', vatIncluded: false })
    );
    expect(revalidatePath).toHaveBeenCalledWith('/admin/settings');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/settings');
  });

  it('ошибка сервиса возвращается как есть, без ревалидации', async () => {
    setCatalogItemActive.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(await setCatalogItemActiveAction('leader', fd({ id: 'ci-1', active: '0' }))).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(setCatalogItemActive).toHaveBeenCalledWith({}, LEADER, 'ci-1', false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('active=1 → true', async () => {
    await setCatalogItemActiveAction('leader', fd({ id: 'ci-1', active: '1' }));
    expect(setCatalogItemActive).toHaveBeenCalledWith({}, LEADER, 'ci-1', true);
  });
});
