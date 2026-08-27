// @vitest-environment jsdom
/**
 * Этап 5 (`У-136`) — диалог позиции каталога и кнопка деактивации/возврата.
 * Server-actions мокируются (боевые тянут prisma); проверяем состав FormData,
 * ошибки в error-регионе Dialog, toast и router.refresh().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { createAction, updateAction, setActiveAction } = vi.hoisted(() => ({
  createAction: vi.fn(),
  updateAction: vi.fn(),
  setActiveAction: vi.fn(),
}));
vi.mock('@/server-actions/admin/catalogItems', () => ({
  createCatalogItemAction: createAction,
  updateCatalogItemAction: updateAction,
  setCatalogItemActiveAction: setActiveAction,
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import {
  CatalogItemDialog,
  CatalogItemActiveButton,
} from '@/components/settings/catalog-item-dialog';
import type { CatalogItemRow } from '@/lib/services/admin/catalogItems';

const DIRECTIONS = [
  { id: 'dir-1', name: 'Охрана труда' },
  { id: 'dir-2', name: 'Пожарная безопасность' },
];

function makeItem(overrides: Partial<CatalogItemRow> = {}): CatalogItemRow {
  return {
    id: 'ci-1',
    name: 'Обучение по охране труда',
    code: 'OT-101',
    unit: 'piece',
    price: '12500.00',
    vatRate: '0.2000',
    vatIncluded: true,
    directionId: 'dir-1',
    directionName: 'Охрана труда',
    description: 'Очная программа',
    isActive: true,
    sortOrder: 5,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

describe('CatalogItemDialog — создание', () => {
  it('триггер «Добавить услугу»; диалог изначально закрыт', () => {
    render(React.createElement(CatalogItemDialog, { cabinet: 'admin' as const, companyId: 'co-1', directions: DIRECTIONS }));
    expect(screen.getByRole('button', { name: 'Добавить услугу' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Новая услуга' })).toBeNull();
  });

  it('успех: FormData несёт companyId и дефолты, toast, refresh, диалог закрыт', async () => {
    createAction.mockResolvedValue({ ok: true });
    render(React.createElement(CatalogItemDialog, { cabinet: 'admin' as const, companyId: 'co-1', directions: DIRECTIONS }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить услугу' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая услуга' });

    fireEvent.change(within(dialog).getByLabelText('Название'), {
      target: { value: 'Инструктаж' },
    });
    fireEvent.change(within(dialog).getByLabelText('Артикул'), { target: { value: 'INS-1' } });
    fireEvent.change(within(dialog).getByLabelText('Цена, ₽'), { target: { value: '990,50' } });
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Добавить' }).closest('form')!);

    await waitFor(() => expect(createAction).toHaveBeenCalled());
    expect(createAction.mock.calls[0]![0]).toBe('admin');
    const fd = createAction.mock.calls[0]![1] as FormData;
    expect(fd.get('companyId')).toBe('co-1');
    expect(fd.get('id')).toBeNull();
    expect(fd.get('name')).toBe('Инструктаж');
    expect(fd.get('code')).toBe('INS-1');
    expect(fd.get('price')).toBe('990,50');
    // Дефолты новой позиции: единица «чел.», НДС не выбран, цена с НДС.
    expect(fd.get('unit')).toBe('person');
    expect(fd.get('vatRate')).toBe('none');
    expect(fd.get('vatIncluded')).toBe('on');
    expect(fd.get('directionId')).toBe('');
    expect(fd.get('sortOrder')).toBe('0');

    expect(toastSuccess).toHaveBeenCalledWith('Услуга добавлена в каталог.');
    expect(refresh).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Новая услуга' })).toBeNull()
    );
    // Форма очищена: при повторном открытии не всплывут прошлые значения.
    fireEvent.click(screen.getByRole('button', { name: 'Добавить услугу' }));
    expect((screen.getByLabelText('Название') as HTMLInputElement).value).toBe('');
  });

  it('validation с messages: список ошибок в alert-регионе, диалог открыт', async () => {
    createAction.mockResolvedValue({
      ok: false,
      error: 'validation',
      messages: ['Цена: неотрицательное число', 'Артикул: от 1 до 64 символов'],
    });
    render(React.createElement(CatalogItemDialog, { cabinet: 'admin' as const, companyId: 'co-1', directions: DIRECTIONS }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить услугу' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая услуга' });

    fireEvent.submit(within(dialog).getByRole('button', { name: 'Добавить' }).closest('form')!);

    expect(await within(dialog).findByText('Цена: неотрицательное число')).toBeTruthy();
    expect(within(dialog).getByText('Артикул: от 1 до 64 символов')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Новая услуга' })).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('duplicate_code: русская подсказка про артикул', async () => {
    createAction.mockResolvedValue({ ok: false, error: 'duplicate_code' });
    render(React.createElement(CatalogItemDialog, { cabinet: 'admin' as const, companyId: 'co-1', directions: DIRECTIONS }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить услугу' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая услуга' });

    fireEvent.submit(within(dialog).getByRole('button', { name: 'Добавить' }).closest('form')!);

    expect(
      await within(dialog).findByText(
        'Такой артикул уже есть в каталоге этой компании — укажите другой.'
      )
    ).toBeTruthy();
  });

  it('неизвестный код: общий fallback «Не удалось сохранить услугу.»', async () => {
    createAction.mockResolvedValue({ ok: false, error: 'boom' });
    render(React.createElement(CatalogItemDialog, { cabinet: 'admin' as const, companyId: 'co-1', directions: DIRECTIONS }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить услугу' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая услуга' });

    fireEvent.submit(within(dialog).getByRole('button', { name: 'Добавить' }).closest('form')!);

    expect(await within(dialog).findByText('Не удалось сохранить услугу.')).toBeTruthy();
  });

  it('«Отмена» закрывает диалог без вызова action', async () => {
    render(React.createElement(CatalogItemDialog, { cabinet: 'admin' as const, companyId: 'co-1', directions: DIRECTIONS }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить услугу' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая услуга' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Новая услуга' })).toBeNull()
    );
    expect(createAction).not.toHaveBeenCalled();
  });
});

describe('CatalogItemDialog — правка', () => {
  it('предзаполнение: ставка «0.2000» → value 0.2 селекта, поля из item', async () => {
    render(
      React.createElement(CatalogItemDialog, {
        cabinet: 'admin' as const,
        companyId: 'co-1',
        directions: DIRECTIONS,
        item: makeItem(),
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Изменить услугу' });

    expect((within(dialog).getByLabelText('Название') as HTMLInputElement).value).toBe(
      'Обучение по охране труда'
    );
    expect((within(dialog).getByLabelText('Артикул') as HTMLInputElement).value).toBe('OT-101');
    expect((within(dialog).getByLabelText('Единица') as HTMLSelectElement).value).toBe('piece');
    expect((within(dialog).getByLabelText('Цена, ₽') as HTMLInputElement).value).toBe('12500.00');
    expect((within(dialog).getByLabelText('Ставка НДС') as HTMLSelectElement).value).toBe('0.2');
    expect((within(dialog).getByLabelText('Направление') as HTMLSelectElement).value).toBe(
      'dir-1'
    );
    expect((within(dialog).getByLabelText('Описание') as HTMLTextAreaElement).value).toBe(
      'Очная программа'
    );
    expect((within(dialog).getByLabelText('Порядок') as HTMLInputElement).value).toBe('5');
  });

  it('НДС null → «не облагается»; успех шлёт id без companyId', async () => {
    updateAction.mockResolvedValue({ ok: true });
    render(
      React.createElement(CatalogItemDialog, {
        cabinet: 'admin' as const,
        companyId: 'co-1',
        directions: DIRECTIONS,
        item: makeItem({ vatRate: null, vatIncluded: false }),
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Изменить услугу' });
    expect((within(dialog).getByLabelText('Ставка НДС') as HTMLSelectElement).value).toBe('none');

    fireEvent.submit(within(dialog).getByRole('button', { name: 'Сохранить' }).closest('form')!);

    await waitFor(() => expect(updateAction).toHaveBeenCalled());
    expect(updateAction.mock.calls[0]![0]).toBe('admin');
    const fd = updateAction.mock.calls[0]![1] as FormData;
    expect(fd.get('id')).toBe('ci-1');
    expect(fd.get('companyId')).toBeNull();
    // Чекбокс «цена включает НДС» снят у item — в FormData его нет.
    expect(fd.get('vatIncluded')).toBeNull();
    expect(toastSuccess).toHaveBeenCalledWith('Услуга обновлена.');
    expect(refresh).toHaveBeenCalled();
  });
});

  it('деактивированное направление позиции не теряется: опция «(неактивно)» выбрана', async () => {
    // Ревью PR-1: активные направления не содержат directionId позиции —
    // без спец-опции браузер выбрал бы «не связано», и правка одной цены
    // молча рвала бы связь (по ней работает «Собрать строки из позиций»).
    render(
      React.createElement(CatalogItemDialog, {
        cabinet: 'admin' as const,
        companyId: 'co-1',
        directions: DIRECTIONS,
        item: makeItem({ directionId: 'dir-gone', directionName: 'Снятое направление' }),
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Изменить услугу' });
    const select = within(dialog).getByLabelText('Направление') as HTMLSelectElement;
    expect(select.value).toBe('dir-gone');
    expect(within(dialog).getByText('Снятое направление (неактивно)')).toBeTruthy();
  });

describe('CatalogItemActiveButton', () => {
  it('деактивация — в два клика: сначала подтверждение, потом action', async () => {
    setActiveAction.mockResolvedValue({ ok: true });
    render(React.createElement(CatalogItemActiveButton, { cabinet: 'admin' as const, item: makeItem() }));

    fireEvent.click(screen.getByRole('button', { name: 'Деактивировать' }));
    expect(setActiveAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Точно деактивировать?' }));
    await waitFor(() => expect(setActiveAction).toHaveBeenCalled());
    expect(setActiveAction.mock.calls[0]![0]).toBe('admin');
    const fd = setActiveAction.mock.calls[0]![1] as FormData;
    expect(fd.get('id')).toBe('ci-1');
    expect(fd.get('active')).toBe('0');
    expect(toastSuccess).toHaveBeenCalledWith(
      'Услуга деактивирована — в новые заказы она не попадёт.'
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('«Отмена» подтверждения возвращает обычную кнопку, action не звался', () => {
    render(React.createElement(CatalogItemActiveButton, { cabinet: 'admin' as const, item: makeItem() }));
    fireEvent.click(screen.getByRole('button', { name: 'Деактивировать' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(screen.getByRole('button', { name: 'Деактивировать' })).toBeTruthy();
    expect(setActiveAction).not.toHaveBeenCalled();
  });

  it('возврат неактивной — один клик «Активировать» с active=1', async () => {
    setActiveAction.mockResolvedValue({ ok: true });
    render(React.createElement(CatalogItemActiveButton, { cabinet: 'admin' as const, item: makeItem({ isActive: false }) }));

    fireEvent.click(screen.getByRole('button', { name: 'Активировать' }));

    await waitFor(() => expect(setActiveAction).toHaveBeenCalled());
    expect(setActiveAction.mock.calls[0]![0]).toBe('admin');
    const fd = setActiveAction.mock.calls[0]![1] as FormData;
    expect(fd.get('active')).toBe('1');
    expect(toastSuccess).toHaveBeenCalledWith('Услуга возвращена в каталог.');
  });

  it('ошибка сервиса — toast.error с русским текстом, refresh не зовётся', async () => {
    setActiveAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(React.createElement(CatalogItemActiveButton, { cabinet: 'admin' as const, item: makeItem() }));

    fireEvent.click(screen.getByRole('button', { name: 'Деактивировать' }));
    fireEvent.click(screen.getByRole('button', { name: 'Точно деактивировать?' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Нет прав изменять каталог этой компании.')
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
